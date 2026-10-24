import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wordSpans } from '../ui/src/lib/wordDiff.ts';

/** Marks each pill in brackets, to compare whole lines at a glance. */
function marked(before: string, after: string): [string, string] | null {
  const spans = wordSpans(before, after);
  if (!spans) return null;
  const mark = (line: string, list: [number, number][]) => {
    let out = '';
    let at = 0;
    for (const [start, length] of list) {
      out += `${line.slice(at, start)}[${line.slice(start, start + length)}]`;
      at = start + length;
    }
    return out + line.slice(at);
  };
  return [mark(before, spans.deletion), mark(after, spans.addition)];
}

describe('word pills', () => {
  it('marks the changed words, as in the Linear mockup', () => {
    assert.deepEqual(
      marked('const dimmedIds: Set<string> = useComputed(() => {', 'const waitingStatusById: Map<string, string> = useComputed(() => {'),
      ['const [dimmedIds]: [Set]<string> = useComputed(() => {', 'const [waitingStatusById]: [Map]<string[, string]> = useComputed(() => {'],
    );
  });

  it('joins words split only by spaces and never starts or ends a pill on a space', () => {
    assert.deepEqual(
      marked(
        ' * screen. Sections are ordered newest first, and rides that were cancelled',
        ' * screen. Sections are ordered newest first, and each ride that is still',
      ),
      [
        ' * screen. Sections are ordered newest first, and [rides] that [were cancelled]',
        ' * screen. Sections are ordered newest first, and [each ride] that [is still]',
      ],
    );
  });

  it('leaves rewritten lines to the line tint', () => {
    assert.equal(marked('ids.add(ride.id);', 'map.set(ride.id, "Driver en route");'), null);
    assert.equal(marked('rides.value', "rides.value.filter((ride) => ride.status === 'driver-assigned'),"), null);
  });

  it('marks nothing when only whitespace changed', () => {
    assert.equal(marked('  return a;', '    return a;'), null);
  });
});
