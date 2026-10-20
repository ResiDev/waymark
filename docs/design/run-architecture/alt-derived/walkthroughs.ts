// Sketch for packages/core/src/run/walkthroughs.ts, about 230 lines.
//
// Owns: what a change does to walkthroughs. It decides every progress entry
// (written through record.ts), the waiting list, the visit and the beacons'
// sightings. Pure: each command is a Work, and the rest read the facts.
//
// Which walkthrough is open is not stored. It is the one entry that is
// checked, running and not collapsed. The visit names it, so finding it on a
// frame is one lookup: the visit counts while its walkthrough's entry is
// open at the visit's step. A visit that does not count is dropped by
// `settle`, so no write has to keep the visit in step with the entry.
//
// Replaces run.ts's collapsedNow, open, release, settle, obey, interrupt,
// arrive, begin, request, resetOne, actOn, lookAtBeacons and setAttached,
// with `machine`, `lastGeneration`, `restored` and `sightings`.

import type { OnStep } from "./rules";
import type { Asked, Facts, Message, Sighting, Work } from "../../../../packages/core/src/state";
import type { WaymarkRead } from "../../../../packages/core/src/run/rules";
import type { Action } from "../../../../packages/core/src/run/types";
import type { Walkthrough, WalkthroughProgress } from "../../../../packages/core/src/walkthrough/types";

// ─── Worked out ─────────────────────────────────────────────────────────────

/**
 * The open walkthrough: the visit's, while its entry is checked, running and
 * not collapsed, at the visit's step. Two lookups, on every frame. After
 * `settle`, an entry that is open always has a visit: a work that opens one
 * makes its visit, and `settle` makes one for any entry left open without.
 */
export function openOf(facts: Facts): OnStep | undefined {
  throw new Error("not implemented");
}

/** The open walkthrough's id, for checklist rows, without its definition. */
export const openId = (facts: Facts): string | undefined => {
  throw new Error("not implemented");
};

/**
 * The walkthroughs the Run draws as beacons: collapsed, running, checked and
 * defined, none while one is open. Cached by the identity of progress,
 * `unchecked`, the definitions and the visit, so a frame that moved none of
 * them costs one comparison.
 */
export function collapsed(facts: Facts): readonly (readonly [Walkthrough, WalkthroughProgress])[] {
  throw new Error("not implemented");
}

/** Where a beacon's Waymark was last seen: its sighting when it is for the step the walkthrough is on, else not looked for yet. */
export function sightingOf(facts: Facts, walkthrough: Walkthrough, entry: WalkthroughProgress): Sighting {
  throw new Error("not implemented");
}

// ─── At the call ────────────────────────────────────────────────────────────

/**
 * A request joins the waiting list at the call, even while the record loads,
 * so a start held meanwhile finds it waiting rather than open. The same
 * object when it already waits.
 */
export function wait(asked: Asked, id: string): Asked {
  throw new Error("not implemented");
}

/** A request withdrawn. The same object when it was not waiting. */
export function unwait(asked: Asked, id: string): Asked {
  throw new Error("not implemented");
}

// ─── Commands ───────────────────────────────────────────────────────────────

/**
 * A walkthrough's restored entry meets its definition, as today's `arrive`:
 * dropped with `recordDropped` if it cannot be picked up again; if it was
 * open, opened again (resumed, so no `start`), or set aside as `dismiss`
 * says when another is open. Every command on a walkthrough does this first.
 */
export const check = (walkthrough: Walkthrough): Work => {
  throw new Error("not implemented");
};

/** `arrival`: every unchecked entry whose definition has come, in the order the definitions came. */
export const checkAll: Work = () => {
  throw new Error("not implemented");
};

/**
 * `run.start`: checked, off the waiting list, and opened as its entry says,
 * fresh, resumed (says `resume`) or restored, after the open one is set
 * aside as its `dismiss` says (says `interrupt`). Nothing when it is open.
 */
export const start = (walkthrough: Walkthrough): Work => {
  throw new Error("not implemented");
};

/**
 * `run.requestStart`'s change: checked, and taken off the waiting list when
 * it has progress, as a request is used up once its walkthrough is found
 * started. `settle` opens it if nothing is open.
 */
export const request = (walkthrough: Walkthrough): Work => {
  throw new Error("not implemented");
};

/**
 * `run.act`. `undefined` for whatever is open when the work runs, which is
 * how a command held while loading finds its walkthrough. On the open one,
 * the rules' `act`; on another, `resume` starts it and `exit` ends it where
 * its entry is (says `exit`); `reset` is `reset`'s.
 */
export const act = (action: Action, walkthrough: Walkthrough | undefined): Work => {
  throw new Error("not implemented");
};

/** `run.reset`: the open one back to step 1 (says `reset`); any other forgotten, unchecked or not. Not checked first. */
export const reset = (walkthrough: Walkthrough): Work => {
  throw new Error("not implemented");
};

/**
 * A message from the page on the open step: the rules' `apply`, then the
 * entry placed at `change.now`, the visit replaced, and what it said told,
 * each event with the snapshot it left. Nothing when nothing is open or the
 * message names another visit. Hands back the same facts when nothing moved,
 * as a still frame does.
 */
export const obey = (message: Message): Work => {
  throw new Error("not implemented");
};

/** The Run detached: the open step stops being looked at, and each beacon's time unseen starts again, as nobody watched. */
export const detached: Work = () => {
  throw new Error("not implemented");
};

/** A frame with nothing open: each beacon sighted from what the page measured, by walkthrough id. */
export const sightBeacons = (reads: ReadonlyMap<string, WaymarkRead>, now: number): Work => {
  throw new Error("not implemented");
};

// ─── End of every change ────────────────────────────────────────────────────

/**
 * Once, after every work of a change, as today's `settle` after each change:
 *
 * 1. A visit that does not count is dropped. If its walkthrough is collapsed,
 *    its sighting goes to the beacon, so the beacon starts where the step
 *    last saw its Waymark.
 * 2. With nothing open, the first request without progress opens fresh, and
 *    every request before it, found started since, is dropped.
 * 3. An entry left open without a visit gets one, resumed.
 * 4. Beacons are kept only while none is open and only for the step each is
 *    on, so each is looked for afresh when it shows again.
 *
 * Once, not after each held command: a request made while loading then waits
 * behind a start held meanwhile, rather than opening and being interrupted.
 */
export const settle: Work = () => {
  throw new Error("not implemented");
};
