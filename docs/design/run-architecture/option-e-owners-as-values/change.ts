// Sketch for packages/core/src/run/change.ts, about 70 lines. Not compiled.
//
// One change in progress: when it happens, and what it has to say once done.
// Every owner's transitions take one. Imports no owner.

import type { WaymarkProblem } from "../problems";
import type { RunEvent } from "./types";

/**
 * What a transition reads of the world, and where it puts what it has to
 * say. The state itself is not here: a transition takes its owner's value and
 * returns the next one. Only `commit` makes a Change and reads back what it
 * gathered, once.
 */
export type Change = Readonly<{
  /** `Date.now()`, once per change: every entry the change writes has the same `changedAt`. */
  now: number;
  /** A renderer draws the Run, so a walkthrough opening in this change opens attached. */
  attached: boolean;
  event: (event: RunEvent) => void;
  /** Reported after the change's notifications, so a handler sees a renderer that has redrawn. */
  problem: (problem: WaymarkProblem) => void;
  /** The checklist a Task's status was changed from, for its event. The last credit for a Task wins. */
  credit: (task: string, checklist: string) => void;
  /** Where the open step asked to be scrolled to. The page scrolls once the state is in. */
  scrollTo: (element: Element) => void;
}>;

export type Gathered = Readonly<{
  events: readonly RunEvent[];
  problems: readonly WaymarkProblem[];
  credits: ReadonlyMap<string, string>;
  scrolls: readonly Element[];
}>;

/**
 * Where a change came from, which says whether it is announced and saved, so
 * no caller passes flags by hand.
 */
export type Source =
  /** The user or the app: saved and announced. */
  | "command"
  /** A checklist or definition reaching the Run: saved, but no checklist events, as it must not announce what the user did before. */
  | "arrival"
  /** A record loaded or heard: storage already holds it, so not saved, and not announced. */
  | "storage";

export const flagsOf = (source: Source): Readonly<{ silent: boolean; persist: boolean }> => ({
  silent: source !== "command",
  persist: source !== "storage",
});

/** Private to `run.ts` in the implementation. After `gather`, a write throws in development. */
export function openChange(now: number, attached: boolean): readonly [Change, () => Gathered] {
  // TODO: four arrays and a Map behind the four writers; `gather` freezes and returns them,
  // then flips a `closed` flag the writers check in development.
  throw new Error("not implemented");
}
