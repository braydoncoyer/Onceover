# Onceover

Give your agent's work a once-over. A minimal, beautiful local diff viewer: run `onceover` in a repo or worktree and review everything the branch would ship, in one stacked view, against `main`. Leave comments on lines, press Done reviewing, and paste the feedback straight back into Claude Code.

Status: in development. See `docs/SPEC.md`.

## Running it

```
npm install && npm run build && npm link   # once, from this checkout
onceover                                   # in any repo or worktree
onceover --base dev --port 5000 --no-open
```

`onceover` serves the review on `127.0.0.1` and opens your browser. Press Ctrl+C to stop. Each worktree gets the same port every run, so a tab left open picks the new run back up instead of opening another one.

## Development

- `npm start` runs the CLI from source against this checkout. `npm run dev` serves the UI with hot reload and proxies `/api` to a server started with `npm start -- --no-open --port 47000`.
- The design playground lives at `playground.html` (`npm run dev`, then open `/playground.html`).
- `npm test` runs the git core, server and CLI tests against throwaway repos (Node 22.18 or later).
- `npm run typecheck` checks both the UI and the Node code.
