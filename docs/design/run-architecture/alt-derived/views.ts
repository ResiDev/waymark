// Sketch for packages/core/src/run/views.ts, about 170 lines. Replaces
// checklists/views.ts (81 lines) and run.ts's openNow, beaconsNow, build,
// seen and sourceFor, with `snapshot`, `openShown`, `beaconsShown` and
// `views`.
//
// Owns nothing stored. Everything the Run hands out, worked out from the
// facts and cached with memo.ts, so it is the same object until something
// in it moves:
//
// - the Run's snapshot: the storage status, the progress, the open
//   walkthrough with its step's Snapshot and its Task, and the beacons;
// - each checklist's snapshot: its rows, the open Task, the storage status.
//
// `commit` evaluates every view once per change, after the facts are in and
// before any callback runs, and `getSnapshot` hands back the last one
// evaluated. So `useSyncExternalStore` sees one object per change, and a
// definition or Task handed over at a call shows only with the next change,
// as today.

import type { Memo } from "./memo";
import type { AnyTask, ChecklistDefinition, ChecklistSnapshot } from "../../../../packages/core/src/checklists/types";
import type { Facts } from "../../../../packages/core/src/state";
import type { RunSnapshot } from "../../../../packages/core/src/run/types";

/** A view of the facts, and the same view of the facts the Run was made with, for a server render. */
export type View<T> = Memo<[Facts], T> &
  Readonly<{
    /** Worked out once, from the facts the Run was made with, before storage was read. */
    server: () => T;
  }>;

/**
 * The Run's snapshot. Its parts are cached apart, each by the identity of
 * what it reads, so a frame on a still Waymark, which moves no fact, hands
 * back the last snapshot without building one:
 *
 * - `open`: by the visit, the open entry, the definition and the groups.
 *   The step's Snapshot is the rules' `running`, handed back as the last
 *   one when no field of it moved.
 * - `beacons`: by `collapsed(facts)` and the beacons' sightings. Each where
 *   its Waymark is found; only the one collapsed most recently goes
 *   without, at the bottom of the screen.
 * - the snapshot: by its four fields.
 */
export function runView(server: Facts): View<RunSnapshot> {
  throw new Error("not implemented");
}

/**
 * One checklist's snapshot, made the first time the checklist is used. Its
 * rows read statuses and progress; `open` reads which walkthrough is open;
 * `storageStatus` reads storage. Cached by those, so a frame moves none.
 */
export function checklistView(definition: ChecklistDefinition<AnyTask>, server: Facts): View<ChecklistSnapshot<AnyTask>> {
  throw new Error("not implemented");
}
