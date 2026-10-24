# Onceover

Give your agent's work a once-over. A minimal, beautiful local diff viewer: run `onceover` in a repo or worktree and review everything the branch would ship, in one stacked view, against `main`. Leave comments on lines, press Done reviewing, and paste the feedback straight back into Claude Code.

Status: in development. See `docs/SPEC.md`.

## Development

- `npm test` runs the git core tests against throwaway repos (Node 22.18 or later).
- `npm run typecheck` checks both the UI and the Node code.
