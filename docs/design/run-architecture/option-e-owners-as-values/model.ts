// Sketch for packages/core/src/run/model.ts, about 140 lines. Not compiled.
//
// The Run's whole state as one value, and the parts of a change that read
// more than one owner. Pure: `run.ts` holds the one `let state`, and every
// change ends here before anything is announced.

import type { StorageStatus } from "../checklists/types";
import type { StoredChanges } from "../storage/records";
import * as B from "./beacons";
import type { Sightings } from "./beacons";
import type { Change } from "./change";
import * as C from "./checklists";
import type { Checklists } from "./checklists";
import type { RunSnapshot } from "./types";
import * as W from "./walkthroughs";
import type { Walkthroughs } from "./walkthroughs";

/**
 * Everything the Run knows. Each field has one owner file, the only one with
 * functions that make a new one. A field that changes nothing keeps its
 * object, so `before.x === after.x` says "x did not change".
 */
export type RunState = Readonly<{
  walkthroughs: Walkthroughs;
  checklists: Checklists;
  sightings: Sightings;
  /** `loading` until the record is in; `error` when it could not be read. Written by `run.ts`'s load alone. */
  storageStatus: StorageStatus;
}>;

/** One change's work: the state as it began, and the change to say things through. */
export type Work = (state: RunState, change: Change) => RunState;

export const initial = (storageStatus: StorageStatus): RunState => ({
  walkthroughs: W.EMPTY_WALKTHROUGHS,
  checklists: { statuses: {}, tasks: new Map(), groups: new Set(), startedFrom: new Map() },
  sightings: B.NO_SIGHTINGS,
  storageStatus,
});

/**
 * What every change does after its work, in order: the walkthroughs settle
 * (a waiting request goes before beacons show), beacons follow, then finished
 * Tasks are recorded, so they are saved and announced with this change.
 * Testable with no DOM: `settle(work(state, change), state, change)` is the
 * whole state side of a change.
 */
export function settle(state: RunState, before: RunState, change: Change): RunState {
  const [walkthroughs, left] = W.settle(state.walkthroughs, change);
  const sightings = B.settle(state.sightings, W.collapsed(walkthroughs), left);
  const checklists = C.finish(state.checklists, before.walkthroughs.progress, walkthroughs.progress);
  return walkthroughs === state.walkthroughs && sightings === state.sightings && checklists === state.checklists
    ? state
    : { ...state, walkthroughs, sightings, checklists };
}

/** What a save carries: only what changed, by identity. `undefined` when the record did not change, as on every frame. */
export function changesOf(before: RunState, after: RunState): StoredChanges | undefined {
  // TODO: same progress and statuses objects → undefined; else changesBetween({ progress, statuses } of each).
  throw new Error("not implemented");
}

/** The Run's snapshot: `previous` itself when nothing in it changed. */
export function selectRun(state: RunState, previous: RunSnapshot): RunSnapshot {
  // TODO:
  // open = W's open machine, running → { walkthrough, snapshot, task: C.taskOf(...) }, reusing previous.open when the same
  // beacons = B.shown(state.sightings, W.collapsed(state.walkthroughs), previous.beacons)
  // previous when storageStatus, progress, open and beacons are all the same objects
  throw new Error("not implemented");
}

/** What checklist snapshots are drawn from. The same inputs as last time mean no checklist can have changed. */
export const seenOf = (state: RunState): C.Seen => ({
  statuses: state.checklists.statuses,
  progress: state.walkthroughs.progress,
  open: state.walkthroughs.open?.walkthrough.id,
  storageStatus: state.storageStatus,
});
