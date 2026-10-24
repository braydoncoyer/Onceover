import type { ChangedFile } from '../../../src/git/index.ts';
import type { BranchesResponse, MetaResponse, ReviewState } from '../../../src/server/api.ts';

/**
 * What `scripts/demo-data.ts` writes: the real git core's output over a
 * made-up repo, for every base the picker offers and every scripted agent
 * edit. The demo's fake server answers the API from this.
 */
export interface DemoData {
  /** The base the demo opens on, as detection would pick it. */
  defaultBase: string;
  branches: BranchesResponse;
  /** One entry per scripted agent edit, in order. The first is the branch as it starts. */
  steps: DemoStep[];
  /** `snapshots[base][step]`: the review against that base after that many edits. */
  snapshots: Record<string, DemoSnapshot[]>;
  /** Every distinct file, so snapshots that share one store it once. */
  files: Record<string, ChangedFile>;
  /** The review a first visit opens with: a few comments, a viewed file and a note. */
  seed: ReviewState;
}

export interface DemoStep {
  /** What the agent did, for the demo bar. Empty for the starting state. */
  label: string;
}

export interface DemoSnapshot {
  meta: MetaResponse;
  head: string;
  mergeBase: string;
  /** Keys into `DemoData.files`, in git's order. */
  files: string[];
}
