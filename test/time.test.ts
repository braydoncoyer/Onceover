import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initials, relativeTime } from '../ui/src/lib/time.ts';

describe('comment times', () => {
  const now = Date.parse('2026-10-24T15:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads short, the way a comment header shows it', () => {
    assert.equal(relativeTime(ago(20_000), now), 'now');
    assert.equal(relativeTime(ago(5 * 60_000), now), '5m ago');
    assert.equal(relativeTime(ago(3 * 3_600_000), now), '3h ago');
    assert.equal(relativeTime(ago(2 * 86_400_000), now), '2d ago');
  });

  it('gives the date for anything older than a week', () => {
    assert.equal(relativeTime('2026-09-03T12:00:00Z', now), 'Sep 3');
    assert.equal(relativeTime('2025-09-03T12:00:00Z', now), 'Sep 3, 2025');
  });

  it("treats a time a little in the future as now, and a bad one as nothing", () => {
    assert.equal(relativeTime(new Date(now + 5_000).toISOString(), now), 'now');
    assert.equal(relativeTime('not a date', now), '');
  });
});

describe('avatar initials', () => {
  it('takes the first and last names', () => {
    assert.equal(initials('Sam Rivera'), 'SR');
    assert.equal(initials('  ada  king lovelace '), 'AL');
    assert.equal(initials('You'), 'Y');
    assert.equal(initials('élodie'), 'É');
    assert.equal(initials(''), '?');
  });
});
