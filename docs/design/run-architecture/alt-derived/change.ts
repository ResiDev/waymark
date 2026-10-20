// Sketch for packages/core/src/run/change.ts, about 90 lines.
//
// Owns: one change's pure part, from the facts before to the facts after,
// and what it told on the way. Holds nothing past the change: today's
// `events`, `problems` and `credits` variables become a sink made per change.
// The shell's `commit` (run.ts) does the rest, which touches the outside.
//
// The order, today's commit steps 2 to 5 for every part of a change:
//
// 1. `storage`, then `finish` against the facts it began with.
// 2. `arrival`: `checkAll`, then `conditions`, then `finish`.
// 3. Each of `commands`, in order, each followed by `finish`.
// 4. `settle`, once.
//
// What is saved and what is announced is worked out from where each part
// ended, not passed in as flags:
//
// - saved: the changes between the facts after `storage` (or before, without
//   one) and after, or the whole record with `whole`. Nothing when the change
//   was `storage` alone, as storage holds what it said.
// - checklist events and `checklistComplete`: between the facts after
//   `arrival` (or after `storage`, or before) and after, and only when a
//   command ran, so neither a load nor a checklist reaching the Run
//   announces what the user did before.
// - run events and problems: as told, in the order told. Run events cannot
//   be worked out from a before and after: going from step 2 to step 1 is
//   `previous` or `reset`, and held commands can move a step twice.
// - `recordUnreadable`: when storage turned `unreadable` from anything else.

import type { WaymarkProblem } from "../../../../packages/core/src/problems";
import type { Change, Facts, Phases, Recorded } from "../../../../packages/core/src/state";
import type { RecordUnreadableError } from "../../../../packages/core/src/storage/records";
import type { RunEvent } from "../../../../packages/core/src/run/types";

/** What a change told while it ran. */
export type Told = Readonly<{
  events: readonly RunEvent[];
  problems: readonly WaymarkProblem[];
  /** The checklist each Task's status was changed from, the last one told. */
  credits: ReadonlyMap<string, string>;
  /** The last Waymark a rule asked to scroll to. */
  scrollTo: Element | undefined;
}>;

export type Ran = Readonly<{
  after: Facts;
  /** What the save is worked out against; `undefined` for nothing to save, `"whole"` for the whole record. */
  savedFrom: Recorded | "whole" | undefined;
  /** What checklist events are worked out against; `undefined` when no command ran. */
  announcedFrom: Recorded | undefined;
  /** Storage turned unreadable in this change, so the record is reported, once. */
  unreadable: RecordUnreadableError | undefined;
  told: Told;
}>;

/**
 * Runs the parts of one change in order. `now` is `Date.now()`, taken once,
 * so every entry the change writes is changed at the same time. `verdicts`
 * asks the app's completion conditions, as no app code runs in a work.
 */
export function runChange(before: Facts, phases: Phases, now: number, verdicts: Change["verdicts"]): Ran {
  throw new Error("not implemented");
}

/** The facts are the same objects and nothing was told: a still frame. `commit` then only re-requests the frame. */
export function idle(before: Facts, ran: Ran): boolean {
  throw new Error("not implemented");
}
