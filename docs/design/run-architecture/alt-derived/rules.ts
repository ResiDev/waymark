// Sketch for packages/core/src/run/rules.ts, about 400 lines. Replaces today's
// rules.ts and run/state.ts (633 lines together).
//
// The rules of one step, over the open walkthrough's definition, its progress
// entry and the visit to its step. Pure, as today. What changes: a rule no
// longer carries a Snapshot. It moves the entry (step, collapsed, ended) and
// the visit (latches, times, the Waymark), and the Snapshot is worked out from
// the three by `running`. So `show` and `gate`, which exist today to keep
// `canAdvance` in step with `unlocked` and the Waymark, go: `canAdvance` is
// worked out, and cannot fall out of step.
//
// Messages name the visit they were raised on by its key, a symbol, so one
// queued behind a step change, or raised on another walkthrough's step, finds
// another key and does nothing. That replaces step generations and the Run's
// `lastGeneration`.
//
// Moved as they are: WaymarkRead, AdvanceRead, StepRead, locate, foundAt,
// scrollTarget, whenDue, WaymarkAria, sameWaymarkAria, NOTHING_LIVE, stepAt.
// Changed to name the visit in place of a step generation: WaymarkEvents,
// sameWaymarkEvents, LiveWatchers. Gone: State, opening, fresh, end, show,
// gate, noChange and the `attached` and `start` messages, which the visit's
// `looked` and the `look` message replace.

import type { Place } from "./record";
import type { Message, Sighting, Visit, VisitKey } from "../../../../packages/core/src/state";
import type { Ended, Running, RunEventType } from "../../../../packages/core/src/run/types";
import type { WaymarkAria, WaymarkRead } from "../../../../packages/core/src/run/rules";
import type { Step, Walkthrough, WalkthroughProgress } from "../../../../packages/core/src/walkthrough/types";

/**
 * A walkthrough on a step, as the rules see it: its entry is running, at the
 * visit's step. The open one is also not collapsed; a walkthrough just
 * collapsed is still on its step, for the Snapshot its events carry.
 */
export type OnStep = Readonly<{ walkthrough: Walkthrough; entry: WalkthroughProgress; visit: Visit }>;

/** The driver says `interrupt` itself, as only it sees another walkthrough start. */
export type MachineEvent = Exclude<RunEventType, "interrupt">;

/**
 * What one message did. `at` is `on.entry` itself and `visit` is `on.visit`
 * itself when they did not move, so the caller's "did anything change" is
 * two identity checks. `visit` is a new one when the step moved, `undefined`
 * once the walkthrough ended, and `on.visit` after a collapse: `settle` hands
 * its sighting to the beacon.
 */
export type Outcome = Readonly<{
  at: Place;
  visit: Visit | undefined;
  events: readonly MachineEvent[];
  /** Reported once, as the Waymark goes, not on every frame it stays gone. */
  waymarkGone?: "lost" | "missing" | undefined;
  /** Dropped when the same message moved the step: no point scrolling to a Waymark just left. */
  scrollTo?: Element | undefined;
}>;

/** A Waymark's own events to listen to, for the visit they would satisfy. */
export type WaymarkEvents = Readonly<{ element: Element; events: readonly string[]; visit: VisitKey }>;

export type LiveWatchers = Readonly<{
  input: boolean;
  frame: boolean;
  waymarkAria: WaymarkAria | undefined;
  waymarkEvents: WaymarkEvents | undefined;
}>;

export const sameWaymarkEvents = (a: WaymarkEvents, b: WaymarkEvents): boolean => {
  throw new Error("not implemented");
};

/** What a visit carries from the step before it: the walkthrough's, not the step's. */
export type Carried = Pick<Visit, "started" | "resumed" | "looked">;

/**
 * One message on the open step:
 *
 * - `act`: advance (only through an open gate), previous, reset, collapse,
 *   resume, exit. No key: an action is for whatever is open.
 * - `stepRead`: the Waymark measured and, while one is due, the condition
 *   checked. May unlock, or advance by itself.
 * - `look`: looked, then the read, then `start`, which says `start` unless
 *   the walkthrough was resumed. One message, so nothing can run between
 *   them, and a look queued behind a step change finds the key of the visit
 *   it measured.
 * - `click`, `event`: the step's condition met. A click away dismisses,
 *   whatever the key.
 * - `detached`: not looked any more; a state check's clock and the time
 *   unseen start again, as nobody watched.
 */
export function apply(on: OnStep, message: Message): Outcome {
  throw new Error("not implemented");
}

/** A visit to `step`, just shown: a new key, nothing done, its Waymark not yet looked for. */
export function enter(walkthrough: Walkthrough, step: number, carried: Carried): Visit {
  throw new Error("not implemented");
}

/** The gate is open: the condition was met, or the Waymark is lost or missing, so the user is never stuck. */
export const canAdvance = (visit: Visit): boolean => {
  throw new Error("not implemented");
};

/**
 * The open step's Snapshot, worked out. Not cached here: `views.ts` caches
 * the one the Run hands out, so it is the same object while nothing in it
 * moved, as today's stored Snapshot is.
 */
export function running(on: OnStep): Running {
  throw new Error("not implemented");
}

/** A walkthrough that has finished or exited, for the event that ended it. */
export const ended = (at: Place): Ended => {
  throw new Error("not implemented");
};

/** The condition is checked on this read. `asLooked` for the first look, which asks before `looked` is set. */
export function needsAdvanceRead(on: OnStep, asLooked?: boolean): boolean {
  throw new Error("not implemented");
}

/** What core listens to for this step. Nothing until it is looked at, so a Run that is not attached touches no page. */
export function liveWatchers(on: OnStep): LiveWatchers {
  throw new Error("not implemented");
}

/** A Waymark not looked for yet: `searching`, or `absent` for a step without one. Worked out, so a beacon needs no entry until it is seen. */
export function unsighted(step: Step, index: number): Sighting {
  throw new Error("not implemented");
}

/** The same Sighting when nothing moved. */
export function sight(previous: Sighting, read: WaymarkRead, now: number, step: Step): Sighting {
  throw new Error("not implemented");
}
