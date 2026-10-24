import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs';
import type { ReviewFile, ReviewMeta } from '../lib/types';

export type { ChangeOrigin, ReviewFile, ReviewMeta } from '../lib/types';

import useRideHistoryOld from './files/useRideHistory.old.ts.txt?raw';
import useRideHistoryNew from './files/useRideHistory.new.ts.txt?raw';
import rideHistoryPageOld from './files/RideHistoryPage.old.tsx.txt?raw';
import rideHistoryPageNew from './files/RideHistoryPage.new.tsx.txt?raw';
import statusCardNew from './files/StatusCard.new.tsx.txt?raw';
import sectionListOld from './files/section-list.old.tsx.txt?raw';
import sectionListNew from './files/section-list.new.tsx.txt?raw';
import rideStatusOld from './files/rideStatus.old.ts.txt?raw';
import statusLabelsNew from './files/statusLabels.new.ts.txt?raw';
import dimmedRowsOld from './files/dimmedRows.old.ts.txt?raw';

export const meta: ReviewMeta = {
  repo: 'rideshare-web',
  branch: 'feature/dimmed-status-cards',
  base: 'origin/main',
  defaultBase: 'origin/main',
  mergeBase: '3f9a2c1',
};

function countLines(diff: FileDiffMetadata) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of diff.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

function textFile(
  input: Omit<ReviewFile, 'additions' | 'deletions' | 'diff'> & {
    oldContents: string | null;
    newContents: string | null;
  },
): ReviewFile {
  const { oldContents, newContents, ...file } = input;
  const diff = parseDiffFromFile(
    oldContents === null ? null : { name: file.prevPath ?? file.path, contents: oldContents },
    newContents === null ? null : { name: file.path, contents: newContents },
    { context: 3 },
  );
  return { ...file, ...countLines(diff), diff };
}

export const files: ReviewFile[] = [
  textFile({
    id: 'use-ride-history',
    path: 'client/src/views/RideHistory/useRideHistory.ts',
    status: 'modified',
    origin: 'committed',
    comments: 2,
    oldContents: useRideHistoryOld,
    newContents: useRideHistoryNew,
  }),
  textFile({
    id: 'ride-history-page',
    path: 'client/src/views/RideHistory/RideHistoryPage.tsx',
    status: 'modified',
    origin: 'uncommitted',
    uncommitted: true,
    comments: 0,
    oldContents: rideHistoryPageOld,
    newContents: rideHistoryPageNew,
  }),
  textFile({
    id: 'status-card',
    path: 'client/src/components/StatusCard/StatusCard.tsx',
    status: 'added',
    origin: 'new',
    uncommitted: true,
    comments: 0,
    oldContents: null,
    newContents: statusCardNew,
  }),
  textFile({
    id: 'section-list',
    path: 'app/src/ui/lib/list/section-list.tsx',
    status: 'modified',
    origin: 'committed',
    comments: 1,
    oldContents: sectionListOld,
    newContents: sectionListNew,
  }),
  textFile({
    id: 'status-labels',
    path: 'client/src/views/RideHistory/statusLabels.ts',
    prevPath: 'client/src/views/RideHistory/rideStatus.ts',
    status: 'renamed',
    origin: 'committed',
    comments: 0,
    oldContents: rideStatusOld,
    newContents: statusLabelsNew,
  }),
  textFile({
    id: 'dimmed-rows',
    path: 'client/src/legacy/dimmedRows.ts',
    status: 'deleted',
    origin: 'committed',
    comments: 0,
    oldContents: dimmedRowsOld,
    newContents: null,
  }),
  {
    id: 'route-map',
    path: 'client/public/img/route-map@2x.png',
    status: 'binary',
    origin: 'uncommitted',
    uncommitted: true,
    additions: 0,
    deletions: 0,
    comments: 0,
    size: { before: 48_213, after: 51_870 },
  },
  {
    id: 'lockfile',
    path: 'package-lock.json',
    status: 'generated',
    origin: 'committed',
    additions: 214,
    deletions: 37,
    comments: 0,
  },
];
