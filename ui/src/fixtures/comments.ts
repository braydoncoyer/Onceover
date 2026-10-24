import { createComment, type ReviewComment } from '../lib/comments';
import { files } from './diff';

const byId = (id: string) => files.find((file) => file.id === id)!;

/** A review in progress on the fixture branch, as Done reviewing's example in the spec. */
export function fixtureComments(): ReviewComment[] {
  // Written over the last hour, so the playground's relative times read the same on any day.
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
  const history = byId('use-ride-history');
  return [
    createComment(
      history,
      { side: 'new', start: 40, end: 43 },
      'Do we need both waitingStatusById and dimmedIds? Keep one, and drop the other from the return value.',
      at(52),
    ),
    createComment(history, { side: 'old', start: 45, end: 45 }, 'Make sure nothing else read this set.', at(41)),
    createComment(byId('ride-history-page'), null, 'Add a test for the full-opacity reset.', at(18)),
    // Written on a line the agent has since rewritten, so it shows as outdated.
    {
      ...createComment(byId('section-list'), { side: 'new', start: 24, end: 24 }, 'Should this fire for mouse focus too?', at(7)),
      text: ['  readonly onRowFocusVisible?: ('],
    },
  ];
}

export const fixtureNote = 'Looks close. Tighten the naming and drop the old set.';
