import { createComment, type ReviewComment } from '../lib/comments';
import { files } from './diff';

const byId = (id: string) => files.find((file) => file.id === id)!;

/** A review in progress on the fixture branch, as Done reviewing's example in the spec. */
export function fixtureComments(): ReviewComment[] {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 24, 10, minute));
  const history = byId('use-ride-history');
  return [
    createComment(
      history,
      { side: 'new', start: 40, end: 43 },
      'Do we need both waitingStatusById and dimmedIds? Keep one, and drop the other from the return value.',
      at(1),
    ),
    createComment(history, { side: 'old', start: 45, end: 45 }, 'Make sure nothing else read this set.', at(2)),
    createComment(byId('ride-history-page'), null, 'Add a test for the full-opacity reset.', at(3)),
    // Written on a line the agent has since rewritten, so it shows as outdated.
    {
      ...createComment(byId('section-list'), { side: 'new', start: 24, end: 24 }, 'Should this fire for mouse focus too?', at(4)),
      text: ['  readonly onRowFocusVisible?: ('],
    },
  ];
}

export const fixtureNote = 'Looks close. Tighten the naming and drop the old set.';
