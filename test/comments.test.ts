import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDiffFromFile } from '@pierre/diffs';
import {
  anchorFromSelection,
  createComment,
  inHunks,
  lineLabel,
  reanchor,
  reanchorAll,
  reviewMarkdown,
} from '../ui/src/lib/comments.ts';
import type { ReviewFile } from '../ui/src/lib/types.ts';

const OLD = `// Build sections from ride history state

const dimmedIds: Set<string> = useComputed(() => {
  const ids = new Set<string>();
  for (const ride of ridesAwaitingPickup) {
    ids.add(ride.id);
  }
  return ids;
});

export function useRideHistory() {
  return { dimmedIds };
}
`;

const NEW = `// Build sections from ride history state

const waitingStatusById: Map<string, string> = useComputed(() => {
  const map = new Map<string, string>();
  for (const ride of ridesAwaitingPickup) {
    map.set(ride.id, "Driver en route");
  }
  return map;
});

export function useRideHistory() {
  return { waitingStatusById };
}
`;

const PATH = 'client/src/views/RideHistory/useRideHistory.ts';

function file(oldText: string | null, newText: string | null, path = PATH): ReviewFile {
  const diff = parseDiffFromFile(
    oldText === null ? null : { name: path, contents: oldText },
    newText === null ? null : { name: path, contents: newText },
    { context: 3 },
  );
  return { id: path, path, status: 'modified', origin: 'committed', additions: 0, deletions: 0, diff };
}

describe('anchorFromSelection', () => {
  const { diff } = file(OLD, NEW);

  it('keeps a one-sided range and orders its ends', () => {
    assert.deepEqual(anchorFromSelection(diff!, { start: 6, side: 'additions', end: 3, endSide: 'additions' }), {
      side: 'new',
      start: 3,
      end: 6,
    });
    assert.deepEqual(anchorFromSelection(diff!, { start: 6, side: 'deletions', end: 6 }), { side: 'old', start: 6, end: 6 });
  });

  it('counts a range from removed lines into added ones on the new file', () => {
    // Old line 3 (`const dimmedIds`) down to new line 4 (`const map`).
    assert.deepEqual(anchorFromSelection(diff!, { start: 3, side: 'deletions', end: 4, endSide: 'additions' }), {
      side: 'new',
      start: 3,
      end: 4,
    });
  });
});

describe('createComment', () => {
  it('captures the lines and two lines of context each way', () => {
    const comment = createComment(file(OLD, NEW), { side: 'new', start: 3, end: 4 }, 'Keep one.');
    assert.deepEqual(comment.text, [
      'const waitingStatusById: Map<string, string> = useComputed(() => {',
      '  const map = new Map<string, string>();',
    ]);
    assert.deepEqual(comment.before, ['// Build sections from ride history state', '']);
    assert.deepEqual(comment.after, ['  for (const ride of ridesAwaitingPickup) {', '    map.set(ride.id, "Driver en route");']);
    assert.equal(comment.outdated, false);
  });

  it('captures removed lines from the old file', () => {
    const comment = createComment(file(OLD, NEW), { side: 'old', start: 6, end: 6 }, 'Did anything read this?');
    assert.deepEqual(comment.text, ['    ids.add(ride.id);']);
  });
});

describe('reanchor', () => {
  const comment = createComment(file(OLD, NEW), { side: 'new', start: 6, end: 6 }, 'Name the status.');

  it('leaves a comment whose lines stayed put alone', () => {
    assert.equal(reanchor(comment, file(OLD, NEW)), comment);
  });

  it('follows code that moved down', () => {
    const moved = NEW.replace('// Build sections', '// Ride history\n// Build sections');
    const result = reanchor(comment, file(OLD, moved));
    assert.equal(result.start, 7);
    assert.equal(result.end, 7);
    assert.equal(result.outdated, false);
  });

  it('follows code that was only re-indented', () => {
    const indented = NEW.replace('    map.set(ride.id', '      map.set(ride.id');
    assert.equal(reanchor(comment, file(OLD, indented)).outdated, false);
  });

  it('picks the copy whose surroundings match when the code appears twice', () => {
    const twice = `${NEW}\nfunction other() {\n    map.set(ride.id, "Driver en route");\n}\n`;
    const moved = `// header\n${twice}`;
    assert.equal(reanchor(comment, file(OLD, moved)).start, 7);
  });

  it('marks a comment outdated when its code is gone, and keeps its place', () => {
    const gone = NEW.replace('    map.set(ride.id, "Driver en route");\n', '');
    const result = reanchor(comment, file(OLD, gone));
    assert.equal(result.outdated, true);
    assert.equal(result.start, 6);
  });

  it('clears outdated once the code comes back', () => {
    const outdated = { ...comment, outdated: true };
    assert.equal(reanchor(outdated, file(OLD, NEW)).outdated, false);
  });

  it('marks a removed-line comment outdated once the line is no longer removed', () => {
    const removed = createComment(file(OLD, NEW), { side: 'old', start: 6, end: 6 }, 'Check this.');
    const restored = NEW.replace('    map.set(ride.id, "Driver en route");\n', '    ids.add(ride.id);\n');
    assert.equal(reanchor(removed, file(OLD, NEW)), removed);
    assert.equal(reanchor(removed, file(OLD, restored)).outdated, true);
  });

  it('marks comments on files no longer in the diff outdated', () => {
    const [result] = reanchorAll([comment], []);
    assert.equal(result.outdated, true);
  });

  it('returns the same list when nothing moved', () => {
    const list = [comment];
    assert.equal(reanchorAll(list, [file(OLD, NEW)]), list);
  });
});

describe('inHunks', () => {
  const big = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const changed = big.replace('line 20\n', 'line twenty\n');
  const { diff } = file(big, changed);

  it('knows which lines the diff draws without expanding', () => {
    assert.equal(inHunks(diff!, { side: 'new', start: 20, end: 20 }), true);
    assert.equal(inHunks(diff!, { side: 'new', start: 5, end: 5 }), false);
  });
});

describe('lineLabel', () => {
  it('names lines and removed lines', () => {
    assert.equal(lineLabel({ side: 'new', start: 81, end: 81 }), 'Line 81');
    assert.equal(lineLabel({ side: 'new', start: 79, end: 82 }), 'Lines 79–82');
    assert.equal(lineLabel({ side: 'old', start: 81, end: 81 }), 'Removed line 81');
    assert.equal(lineLabel({ side: null, start: null, end: null }), 'File');
  });
});

describe('reviewMarkdown', () => {
  it('writes the block Claude Code gets', () => {
    const current = file(OLD, NEW);
    const page = file('export const Page = () => null;\n', 'export const Page = () => <div />;\n', 'client/src/views/RideHistory/RideHistoryPage.tsx');
    const comments = [
      createComment(page, null, 'Add a test for the full-opacity reset.', new Date('2026-10-24T10:03:00Z')),
      createComment(current, { side: 'old', start: 6, end: 6 }, 'Make sure nothing else read this set.', new Date('2026-10-24T10:02:00Z')),
      createComment(current, { side: 'new', start: 3, end: 6 }, 'Do we need both waitingStatusById and dimmedIds?\nKeep one.', new Date('2026-10-24T10:01:00Z')),
    ];
    const markdown = reviewMarkdown({
      branch: 'feature/dimmed-status-cards',
      base: 'origin/main',
      note: 'Looks close. Tighten the naming and drop the old set.',
      comments,
      files: [current, page],
    });
    assert.equal(
      markdown,
      `Review of feature/dimmed-status-cards against origin/main (3 comments)

Overall: Looks close. Tighten the naming and drop the old set.

1. client/src/views/RideHistory/useRideHistory.ts:3-6
   > const waitingStatusById: Map<string, string> = useComputed(() => {
   > …
   > map.set(ride.id, "Driver en route");
   Do we need both waitingStatusById and dimmedIds?
   Keep one.

2. client/src/views/RideHistory/useRideHistory.ts:5 (removed line)
   > ids.add(ride.id);
   Make sure nothing else read this set.

3. client/src/views/RideHistory/RideHistoryPage.tsx (whole file)
   Add a test for the full-opacity reset.
`,
    );
  });

  it('says one comment, and leaves out empty ones', () => {
    const current = file(OLD, NEW);
    const markdown = reviewMarkdown({
      branch: 'b',
      base: 'main',
      note: '',
      comments: [createComment(current, { side: 'new', start: 3, end: 3 }, 'Rename.'), createComment(current, null, '  ')],
      files: [current],
    });
    assert.match(markdown, /^Review of b against main \(1 comment\)\n\n1\. /);
  });

  it('flags outdated comments', () => {
    const current = file(OLD, NEW);
    const comment = { ...createComment(current, { side: 'new', start: 3, end: 3 }, 'Rename.'), outdated: true };
    const markdown = reviewMarkdown({ branch: 'b', base: 'main', note: '', comments: [comment], files: [current] });
    assert.match(markdown, /useRideHistory\.ts:3 \(outdated: this code has changed since the comment\)/);
  });
});
