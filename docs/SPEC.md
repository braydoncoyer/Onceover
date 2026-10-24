# Onceover v1 Build Spec

Oct 24, 2026 · Braydon Coyer

## Goal

A local, read-only diff viewer that shows everything a branch would ship in one beautiful, stacked view, so I can review what a Claude Code agent left behind without an IDE or `git diff` in the terminal.

- I run one command in the repo or worktree the agent worked in. A browser tab opens on the full diff against `main`.
- I scroll through every changed file, mark files as viewed, and leave comments on lines or ranges.
- I press Done reviewing. All my comments are copied as one Markdown block that I paste back into Claude Code.
- I review one branch at a time. No multi-repo or multi-worktree switching.

## Design bar

The UI is the product. Hold every screen to the craft of [Linear](https://linear.app), and spend more time on design and polish than on any other part of the build. Working but plain is not done.

The two reference mockups aren't in the repo. The notes below describe what to take from each, and the screenshots in `docs/screenshots` show where the build landed. Read both before any UI work.

### Mockup 1: Linear's agent review screen

A Linear-style diff review: breadcrumb header, pill tabs, a diff card with tinted added and removed lines, and an agent panel on the right.

What to take from it:

- Near-black canvas. Content sits in rounded panels with 1 px hairline borders only slightly lighter than the background.
- Top row: an issue key, a chevron, a branch icon and the branch title, then `+34` in green and `-18` in red. Small, quiet, perfectly aligned.
- Pill tabs (Activity, Guide, Diff) with the selected one on a slightly lighter fill. Secondary buttons on the right are just as quiet, with one round primary icon button.
- File card header: a TypeScript file icon, the file name in near-white, the folder path in dim gray, and the line counts right-aligned.
- Code: monospaced, roomy line height, dim line numbers. Removed lines sit on a dark red tint with a red `-` and a red bar at the left edge. Added lines sit on a dark green tint with a green bar.
- Changed words get a brighter rounded pill on top of the line tint (`dimmedIds` vs `waitingStatusById`).
- The bottom of the card fades out, and the next file's header peeks through dimmed. That's the stacked feel.
- The agent panel on the right is out of scope for v1.

### Mockup 2: Changes sidebar and diff

A Changes view: a sidebar listing three changed files with shortened paths, and a large diff card with grouped added lines and green plus markers.

What to take from it:

- Sidebar header "Changes" with a small count badge and a chevron.
- File rows shorten the middle of the path (`app/…/section-list.tsx`): folders in gray, the file name in white, a small status icon on the right. The selected row has a soft rounded fill.
- The diff is one large rounded card on a slightly lighter surface, with the file path in its header and a settings control on the right.
- Added lines are grouped into one rounded, tinted region per hunk, with a green plus-circle marker at the start and a dotted connector down the side.
- Syntax colors are soft: purple for types and keywords, a muted red for modifiers like `readonly`, gray for punctuation.
- The commit box and Stashed changes are out of scope for v1.

### Craft rules

- Spacing on a 4 px grid. Consistent radii: about 6 px for rows and pills, 10 to 12 px for cards.
- Type: Inter for UI at 13 px, medium weight for file names. A clean monospaced font (Geist Mono, JetBrains Mono or Berkeley Mono) at 13 px for code. Tabular numbers for every count.
- Color: layered grays for background, surface, raised surface and hairline, plus one accent. Low-saturation tints for added and removed lines. No pure white text.
- Motion: 120 to 180 ms ease-out for hover, collapse and viewed states. Nothing bouncy. Respect reduced-motion settings.
- States: every control has hover, focus-visible, active and disabled styles. Loading uses skeletons, not spinners. Empty and error states are designed, not default text.
- Details: sticky headers get a subtle shadow once stuck, scrollbars are thin and dark, long paths shorten in the middle, and edges fade instead of cutting off.
- Keyboard first. Every action in the UI has a shortcut, and a `Cmd+K` jump-to-file menu is a welcome extra.

### How to work on the UI

1. Before wiring up git, build a design playground page that renders a fixture diff (TypeScript and TSX files, with added, removed, changed and folded lines).
2. Put every color, font, size, radius and shadow in one tokens file.
3. Take screenshots of the playground with Playwright, compare them against both mockups, and fix what's off. Do at least three rounds of this.
4. Stop and show me the screenshots before moving on.

## Decisions

These are defaults. Each one can be changed before the build starts.

| Decision | Choice | Why | Alternative |
| --- | --- | --- | --- |
| Form factor | Node CLI that serves a local web UI and opens the browser | Knows the repo from the current folder, starts instantly, no app signing | Wrap the same UI in Tauri later for a dock icon |
| Diff rendering | [@pierre/diffs](https://diffs.com/) | Shiki highlighting, stacked layout, line selection, an annotation hook for comments, and virtualization are already built | Own renderer on Shiki plus jsdiff |
| UI framework | React + Vite + TypeScript | Pierre ships first-class React components | Angular, using Pierre's plain JS classes |
| Styling | Tailwind or CSS modules with a small token file | Fast to tune toward the mockups | Any |
| Package name | `@braydoncoyer/onceover`, command `onceover` | The plain npm name is taken | |

## How it runs

One command, run from anywhere inside a git repo or linked worktree.

```
onceover              # diff current branch against the detected base
onceover --base dev   # diff against another branch
onceover --port 5000  # pick a port (default: first free port)
onceover --no-open    # don't open the browser
```

- Find the repo root with `git rev-parse --show-toplevel` from the current folder. Exit with a clear message outside a git repo.
- Start a small HTTP server bound to `127.0.0.1` only. It serves the built UI and a JSON API.
- Open the default browser at the server's URL.
- Push changes to the page over Server-Sent Events or a WebSocket.
- Stop the server on Ctrl+C. If the tab is already open from an earlier run, reuse it if possible.

API the UI needs:

- `GET /api/meta`: repo name, current branch, base branch, merge-base SHA, worktree path.
- `GET /api/diff`: the parsed diff for every changed file, plus old and new file contents for highlighting.
- `GET /api/branches`: local and remote branches for the base picker.
- `GET /api/review` and `PUT /api/review`: viewed state and comments.
- `GET /api/events`: change notifications.

## What it diffs

The default view is everything the branch would ship: commits, staged, unstaged and untracked files, compared to the point where the branch left the base. The tool never writes to the index, the working tree or any ref.

Base branch:

1. `--base` if given, else the base saved for this repo.
2. Else `git symbolic-ref --quiet refs/remotes/origin/HEAD` (for example `origin/main`).
3. Else the first that exists of `origin/main`, `origin/master`, `main`, `master`.
4. Prefer the remote ref over the local one, since local `main` is often stale. No automatic `git fetch` in v1.

Building the diff:

- `MB = git merge-base <base> HEAD`. Comparing from the merge-base keeps new commits on the base out of the view.
- Tracked changes: `git diff -M --no-color --no-ext-diff MB --`. This compares the merge-base to the working tree, so committed, staged and unstaged edits all land in one diff.
- Untracked files: `git ls-files --others --exclude-standard`, each shown as a new file. Plain `git diff` skips these, and agents create new files all the time.
- Old contents from `git show MB:<path>`, new contents from disk, so the UI can highlight whole files and expand context.
- Tag each file with where its changes live (committed, uncommitted, new) using `git diff --name-only MB HEAD`, `git diff --name-only HEAD` and the untracked list. Show it as a small badge.
- Detached HEAD: show the short SHA in place of the branch name.

Live refresh:

- Watch the worktree with `@parcel/watcher` or `chokidar`, skipping ignored paths.
- Also watch HEAD and the index. In a linked worktree `.git` is a file, so get paths from `git rev-parse --git-dir` (HEAD, index) and `--git-common-dir` (refs).
- Debounce about 250 ms, rebuild the diff, push an event, and keep the scroll position.

## Layout

Three parts, dark and minimal, matching the two mockups in the Design bar: the header from the Linear one, the file rail and code style from the Changes one.

Header (one row):

- Left: repo name, then `branch → base`, with the base as a dropdown of branches. Total lines added and removed in green and red.
- Right: a viewed count ("4 of 9 viewed"), a comment count, and the Done reviewing button.

File rail (left, collapsible):

- One row per changed file: the path with the middle folders shortened (`app/…/section-list.tsx`), lines added and removed, a status badge, and a viewed checkmark.
- Clicking a row scrolls the main view to that file. The current file is highlighted as you scroll.
- Files with comments show a small count.

Main view (stacked):

- Every file stacked in one scroll, in the same order as the rail.
- Each file is a rounded card with a sticky header: file icon, file name, dimmed folder path, lines added and removed, a viewed checkbox, and a collapse toggle.
- Marking a file viewed collapses it. If the file changes again, it uncollapses and its viewed mark clears.
- Unchanged runs fold down to 3 lines of context, with a control to expand them.
- Unified layout by default. Pierre's split layout can be a toggle if it's free.

Keyboard:

- `j` / `k`: next and previous file
- `n` / `p`: next and previous change
- `v`: mark the current file viewed
- `c`: comment on the selected line or range
- `Esc`: cancel a comment, `Cmd+Enter`: save it
- `Cmd+Shift+Enter`: Done reviewing

## Highlighting

Highlighting is the product, so it gets the most polish.

- Syntax: Shiki through Pierre, with the language picked from the file extension. Highlight the whole old and new file, then show the diff lines. Highlighting only the hunks breaks multi-line strings, comments and template literals.
- Line tint: added lines get a soft green background, removed lines a soft red one, with a 2 px colored bar at the left edge, as in the Linear mockup.
- Word-level changes: inside a changed line pair, the exact words that changed get a stronger rounded pill (like `dimmedIds` → `waitingStatusById` in the mockup). Use Pierre's in-line highlighting if it does this, else `diffWordsWithSpace` from `jsdiff`.
- Gutter: old and new line numbers, dimmed. Hovering a number shows the add-comment button.
- Theme: one dark theme to start, tuned to the mockups (near-black background, muted gray context lines, soft purple and blue syntax colors). Keep every color in CSS variables so a light theme is a later swap.
- Font: a monospaced font with ligatures off by default, at 13 to 14 px with roomy line height.

## Comments and Done reviewing

Comments live in the diff, survive refreshes and restarts, and turn into one paste-ready block for Claude Code.

Writing comments:

- Click a line number for one line, or drag across numbers for a range. Removed lines can be commented on too.
- The comment box opens right under the selected code, using Pierre's annotation hook. Saved comments stay inline as small cards you can edit or delete.
- A comment button in each file header adds a file-level comment. One general note for the whole review sits by the Done button.

Storing them:

- Save to `<git-dir>/onceover/review.json`, keyed by branch and base. It lives inside `.git`, so it never shows up in the repo, and it survives a browser refresh or a restart.
- Each comment stores the path, side (new or old), line range, the exact text of those lines, and a couple of lines of context around them.
- After a refresh, find the code again by its text. If it moved, update the line numbers. If it's gone, keep the comment and mark it outdated.

Done reviewing:

- Copy the block below to the clipboard, show a short confirmation, and also write it to `<git-dir>/onceover/last-review.md`.
- Don't clear comments automatically. Offer a Clear comments button after copying.
- Line numbers refer to the file as it is on disk now. Comments on removed lines say so.

```markdown
Review of feature/dimmed-status-cards against origin/main (3 comments)

Overall: Looks close. Tighten the naming and drop the old set.

1. client/src/views/RideHistory/useRideHistory.ts:79-82
   > const waitingStatusById: Map<string, string> = useComputed(() => {
   Do we need both waitingStatusById and dimmedIds? Keep one.

2. client/src/views/RideHistory/useRideHistory.ts:81 (removed line)
   > ids.add(ride.id);
   Make sure nothing else read this set.

3. client/src/views/RideHistory/RideHistoryPage.tsx (whole file)
   Add a test for the full-opacity reset.
```

Quoting the code lets Claude find the right spot even if the agent has moved lines since. Long ranges quote only the first and last lines.

## Edge cases

| Case | What to show |
| --- | --- |
| Lockfiles and generated files (`package-lock.json`, `pnpm-lock.yaml`, `*.min.js`, files marked `linguist-generated` in `.gitattributes`) | Folded card with counts and a Show diff button. Excluded from "viewed" progress. |
| Renamed file | `old/path → new/path` in the header, plus any content changes |
| Deleted file | Header with a Deleted badge, contents folded by default |
| New file | New badge, all lines as added |
| Binary file | Header with a Binary badge and the size change, no lines |
| Mode change only | Header with the old and new mode |
| Very large file (over about 2,000 changed lines) | Folded by default with a Load diff button |
| No changes | A calm empty state: "Nothing to review against origin/main" |
| Base branch missing | Explain which branches were tried and open the base picker |
| Not a git repo | Exit in the terminal with a one-line message, no browser |

Pierre's virtualization should keep big diffs smooth. Test with a diff of 100 or more files.

## Out of scope for v1

v1 is read-only. Anything that writes to git, or links to a remote or an agent, waits.

- Committing, staging, stashing or discarding (the commit box and Stashed changes in the second mockup)
- The agent session panel from the Linear mockup
- Worktree or repo switching
- GitHub PR integration and posting review comments
- Sending feedback straight to a Claude Code session (a later plugin, so Done skips the clipboard)
- Per-commit view, editing files, light theme, native app wrapper

## Build order

Seven milestones, each one usable on its own. Stop after each for a look before moving on. Design comes first and gets the most time.

1. Design playground: the tokens file and a static page that renders a fixture diff with Pierre, following the Design bar. Screenshot, compare with both mockups, refine at least three rounds, then stop for my review.
2. Git core: a Node module that finds the repo, detects the base, computes the merge-base and returns parsed file diffs with old and new contents, including untracked files. Unit tests against throwaway repos made in a temp folder (committed, staged, unstaged, untracked, renamed, deleted, binary, linked worktree).
3. CLI and server: the command, flags, the `127.0.0.1` server, the JSON API and opening the browser.
4. Stacked view: the header, the file rail and every real file rendered with the playground's styles. Folded context and edge-case states.
5. Polish pass: word-level pills, sticky headers, viewed state, motion, keyboard shortcuts. Screenshot again and tune against the two mockups side by side.
6. Live refresh: file watching, debounced rebuilds, events to the page, scroll kept in place.
7. Comments: line and range selection, inline boxes, storage in `.git`, re-anchoring, Done reviewing and the copied block. The comment box gets the same design care as the diff.

## Done when

- [ ] Running the command in a branch with commits, staged, unstaged and new files shows all four in one view against `origin/main`
- [ ] Running it inside a linked worktree diffs that worktree's branch, not the main checkout
- [ ] Changing the base branch updates the diff and is remembered next run
- [ ] Editing a file while the page is open updates it within a second, without losing scroll or comments
- [ ] Multi-line strings and block comments highlight correctly in every hunk
- [ ] Changed words inside a modified line get their own highlight
- [ ] Comments survive a browser refresh and a server restart
- [ ] A comment whose code moved still points at the right lines, and one whose code is gone is marked outdated
- [ ] Done reviewing copies a block that Claude Code acts on without asking where anything is
- [ ] The command never changes the index, working tree or refs
- [ ] Screenshots of the real app hold up side by side with both mockups, and nothing looks like a default component

## Sources

- [Diffs, from Pierre](https://diffs.com/) and its [README](https://cdn.jsdelivr.net/npm/@pierre/diffs@1.5.1/README.md)
- Similar tools to borrow from: [difit](https://github.com/yoshiko-pg/difit), [diffle](https://diffle.app/), [local-review](https://github.com/shaharz/local-review), [claude-diff-review](https://github.com/rubymatrix/claude-diff-review)
