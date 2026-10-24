import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareFiles, isEmptyDelta, reuseUnchanged } from '../ui/src/lib/live.ts';
import type { ReviewFile } from '../ui/src/lib/types.ts';

const file = (id: string, version: string, extra: Partial<ReviewFile> = {}): ReviewFile => ({
  id,
  path: id,
  status: 'modified',
  origin: 'uncommitted',
  additions: 1,
  deletions: 0,
  comments: 0,
  version,
  ...extra,
});

describe('live refresh on the page', () => {
  it('sorts files into changed, added and removed by their version', () => {
    const prev = [file('a.ts', '1'), file('b.ts', '1'), file('c.ts', '1')];
    const next = [file('a.ts', '1'), file('b.ts', '2'), file('d.ts', '1')];
    assert.deepEqual(compareFiles(prev, next), { changed: ['b.ts'], added: ['d.ts'], removed: ['c.ts'] });
    assert.equal(isEmptyDelta(compareFiles(prev, prev)), true);
  });

  it("doesn't count a commit that leaves the diff alone as a change", () => {
    const prev = [file('a.ts', '1', { origin: 'uncommitted', uncommitted: true })];
    const next = [file('a.ts', '1', { origin: 'committed', uncommitted: false })];
    assert.equal(isEmptyDelta(compareFiles(prev, next)), true);
    // But the card still gets the new origin.
    assert.notEqual(reuseUnchanged(prev, next)[0], prev[0]);
  });

  it('keeps the old object for files that are the same, so their cards are not drawn again', () => {
    const prev = [file('a.ts', '1'), file('b.ts', '1')];
    const next = [file('a.ts', '1'), file('b.ts', '2')];
    const merged = reuseUnchanged(prev, next);
    assert.equal(merged[0], prev[0]);
    assert.equal(merged[1], next[1]);
  });
});
