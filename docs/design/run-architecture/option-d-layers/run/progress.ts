import type { DropReason } from "../problems";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { Collapsed } from "./layer";
import { unsighted } from "./rules";
import type { Sighting } from "./rules";
import { stepAt } from "./state";
import type { Snapshot } from "./types";

/*
 * Pure rules over walkthrough progress, which the core applies. Lifted out of
 * today's `createRun` closure so the core holds state and order, and these
 * hold the decisions. About 140 lines once filled in.
 */

type Progress = Readonly<Record<string, WalkthroughProgress>>;

/** Progress with one entry replaced or removed: a new object, as identity says what changed. */
export function withEntry(progress: Progress, id: string, value: WalkthroughProgress | undefined): Progress {
  throw new Error("not implemented");
}

/** The entry for a walkthrough as shown: `was` itself when its step, phase and whether it is collapsed are unchanged. */
export function recorded(was: WalkthroughProgress | undefined, shown: Snapshot, now: number): WalkthroughProgress {
  // TODO: as run.ts's `record` today, returning `was` in place of returning early.
  throw new Error("not implemented");
}

/** What a walkthrough's definition makes of its restored progress. */
export type Arrival =
  | Readonly<{ kind: "keep" }>
  /** It cannot be picked up again. */
  | Readonly<{ kind: "drop"; reason: DropReason }>
  /** It was open, and nothing else is: open it again where it was. */
  | Readonly<{ kind: "open"; step: number }>
  /** It was open, and another is: set aside as its `dismiss` says, as if interrupted. */
  | Readonly<{ kind: "setAside"; progress: WalkthroughProgress }>;

export function arrival(
  saved: WalkthroughProgress,
  walkthrough: Walkthrough,
  somethingOpen: boolean,
  now: number,
): Arrival {
  // TODO: staleness(saved, steps.length, maxAge ?? DEFAULT_MAX_AGE) -> drop; not running or collapsed -> keep;
  // nothing open -> open at saved.step; dismiss "exit" -> exited now; otherwise collapsed now.
  throw new Error("not implemented");
}

/**
 * A walkthrough's entry in a record saved elsewhere: kept as this Run has it
 * when it is open here or this Run changed it since, and collapsed when it is
 * open there, so only one is open here. `ours` itself when nothing differs.
 */
export function heardEntry(
  ours: WalkthroughProgress | undefined,
  heard: WalkthroughProgress | undefined,
  openHere: boolean,
): WalkthroughProgress | undefined {
  throw new Error("not implemented");
}

/** A record heard, entry by entry: the progress to keep, and which ids now wait for their definition or no longer do. */
export type Heard = Readonly<{
  /** `ours` itself when no entry moved. */
  progress: Progress;
  /** Taken from the record heard, with no definition here yet: they wait to be checked, as ones loaded do. */
  unchecked: readonly string[];
  /** Gone from the record heard. */
  forgotten: readonly string[];
}>;

export function mergeHeard(
  ours: Progress,
  heard: Progress,
  open: string | undefined,
  defined: (id: string) => boolean,
): Heard {
  // TODO: as run.ts's `hear` loop today, over the union of ids, with heardEntry(ours[id], heard[id], id === open).
  throw new Error("not implemented");
}

// Beacons

/** Running and collapsed, with a definition, and checked against it. */
export function collapsedIn(
  progress: Progress,
  definitions: ReadonlyMap<string, Walkthrough>,
  unchecked: ReadonlySet<string>,
  sightings: ReadonlyMap<string, Sighting>,
): Collapsed[] {
  throw new Error("not implemented");
}

/** A beacon's Waymark is looked for afresh each time it shows: it may have moved while another walkthrough was open. */
export function nextSightings(collapsed: readonly Collapsed[]): Map<string, Sighting> {
  // TODO: each keeps its sighting if still on the same step, else unsighted(stepAt(walkthrough, step), step).
  throw new Error("not implemented");
}
