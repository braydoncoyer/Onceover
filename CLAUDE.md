# Onceover

A local, read-only git diff viewer for reviewing what coding agents changed. `onceover` runs in a repo or worktree, serves a web UI on 127.0.0.1 and opens the browser on one stacked view of the branch against its base.

## Read first

- `docs/SPEC.md` is the source of truth: scope, git rules, layout, comment format and the seven milestones.
- The spec's Design bar describes the two reference mockups, and `docs/screenshots` shows the current build. Read both before touching any UI.

## How to work

- Build one milestone at a time, in the order in the spec. Stop at the end of each and summarize what changed, with screenshots for UI work.
- UI craft is the top priority. Hold every screen to Linear's level of polish. Use Playwright screenshots to compare your work against the mockups, and iterate until it holds up side by side.
- All design values (color, type, spacing, radius, shadow, motion) live in one tokens file. No one-off values in components.
- The tool must never write to the git index, working tree or refs of the repo it reviews. Its own state lives under `<git-dir>/onceover/`.
- Keep v1 read-only. Anything in the spec's Out of scope list waits.
