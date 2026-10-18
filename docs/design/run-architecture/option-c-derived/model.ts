// Sketch for packages/core/src/run/model.ts. Not compiled.
//
// The Run's basis, and everything worked out from it. Pure: nothing here
// writes. `change.ts` is the only writer; `run.ts` and `page.ts` read.

import type { Stored } from "../checklists/record";
import type { Moment } from "../checklists/tasks";
import type { DefinedTask, StorageStatus } from "../checklists/types";
import { inDevelopment } from "../dev";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { unsighted } from "./rules";
import type { Sighting } from "./rules";
import { stepAt } from "./state";
import type { State } from "./state";
import type { Beacon, OpenWalkthrough, RunSnapshot, Snapshot } from "./types";

// The basis: what cannot be worked out from anything else.

/**
 * Everything the Run holds about the user's walkthroughs and checklists.
 * Which walkthrough is open, which beacons show, which progress still waits
 * for its definition and where the next step generation starts are not
 * here: they are worked out from it each time, below, so they cannot fall
 * out of step with it.
 */
export type Model = Readonly<{
  /**
   * Handed over as each walkthrough is used, the first under each id. Only
   * `meet` adds one, inside a change, and it checks the walkthrough's
   * restored progress as it does: see `isPending`. Never saved.
   */
  definitions: ReadonlyMap<string, Walkthrough>;
  /**
   * Every walkthrough the user has started, saved. The one place any
   * walkthrough's step, phase and collapse are kept, the open one's too.
   */
  progress: Readonly<Record<string, WalkthroughProgress>>;
  /** Each Task off todo, saved. */
  statuses: Stored;
  storageStatus: StorageStatus;
  /** From `requestStart`, oldest first. Not saved: the app asks again on the next load. */
  waiting: readonly Walkthrough[];
  last: Machine | undefined;
  sightings: Sightings;
  /** The checklist whose Start began each running walkthrough, by the walkthrough's id, so a skip from its popover names it. */
  startedFrom: ReadonlyMap<string, string>;
  /** Every Task of the checklists that have reached the Run, by id, in the order they arrived; the first definition of each id. */
  tasks: ReadonlyMap<string, DefinedTask>;
}>;

/**
 * The State of the walkthrough opened most recently, and the progress entry
 * it last wrote. It is the open walkthrough's machine only while that entry
 * is still the walkthrough's progress (`machineOf`). Any other write to the
 * entry retires it, so its step and phase can never disagree with the
 * record: they are checked, by identity, each time, not kept in step.
 *
 * Retired, it is kept for the two things that carry on from it: the next
 * machine's step generation (`epochOf`), and where a walkthrough that has
 * just collapsed last saw its Waymark (`sightingOf`).
 */
export type Machine = Readonly<{
  walkthrough: Walkthrough;
  progress: WalkthroughProgress;
  state: State;
}>;

/**
 * Where each beacon's Waymark was last seen, all while nothing had opened
 * since `epoch`. Opening a walkthrough moves the epoch on, which retires
 * every sighting at once: a beacon's Waymark is looked for afresh each time
 * it shows, as it may have moved while another walkthrough was open.
 */
export type Sightings = Readonly<{ epoch: number; byId: ReadonlyMap<string, Sighting> }>;

export const NO_SIGHTINGS: Sightings = { epoch: -1, byId: new Map() };

// Worked out from the basis.

/** Progress from storage waits as data until its definition arrives. `meet` checks it then, so no other flag is needed. */
export const isPending = (model: Model, id: string): boolean =>
  model.progress[id] !== undefined && !model.definitions.has(id);

/** Running and not collapsed: its popover shows, once its definition is here. */
export const shows = (entry: WalkthroughProgress): boolean => entry.status === "running" && !entry.collapsed;

/**
 * The walkthrough whose popover shows: running, not collapsed, and not
 * pending. `put` in `change.ts` refuses, in development, a second one.
 */
export function openId(model: Model): string | undefined {
  for (const [id, entry] of Object.entries(model.progress)) {
    if (shows(entry) && model.definitions.has(id)) return id;
  }
  return undefined;
}

export const openWalkthrough = (model: Model): Walkthrough | undefined => {
  const id = openId(model);
  return id === undefined ? undefined : model.definitions.get(id);
};

/**
 * The open walkthrough's machine, the one thing `rules.ts` works on. None
 * while nothing is open. Between changes the open walkthrough always has
 * one, as each change ends with `pickUp`.
 */
export function machineOf(model: Model): Machine | undefined {
  const id = openId(model);
  const last = model.last;
  return id !== undefined && last?.walkthrough.id === id && last.progress === model.progress[id] ? last : undefined;
}

/**
 * The step generation the next machine's steps follow. It moves only while a
 * walkthrough is open, so it also dates sightings: see `Sightings`.
 */
export const epochOf = (model: Model): number => model.last?.state.stepGeneration ?? -1;

/** A collapsed walkthrough the Run can draw as a beacon. */
export type Candidate = Readonly<{
  walkthrough: Walkthrough;
  progress: WalkthroughProgress;
  sighting: Sighting;
}>;

/** Collapsed walkthroughs the Run can draw as beacons: none while one is open, and none still pending. */
export function candidates(model: Model): readonly Candidate[] {
  // TODO
  // if (openId(model) !== undefined) return [];
  // for each [id, entry] of progress: entry running && collapsed && definitions.get(id)
  //   → { walkthrough, progress: entry, sighting: sightingOf(model, walkthrough, entry) }
  throw new Error("not implemented");
}

/**
 * Where a beacon's Waymark is: as last seen, while that sighting is still
 * good; where the walkthrough's own machine last saw it, when it has just
 * collapsed; otherwise not yet looked for.
 */
export function sightingOf(model: Model, walkthrough: Walkthrough, entry: WalkthroughProgress): Sighting {
  const seen = model.sightings.byId.get(walkthrough.id);
  if (seen !== undefined && model.sightings.epoch === epochOf(model) && seen.stepIndex === entry.step) return seen;
  const last = model.last;
  if (last?.walkthrough.id === walkthrough.id && last.progress === entry && last.state.snapshot.phase === "running") {
    const { snapshot, unseenSince, element } = last.state;
    return { stepIndex: snapshot.stepIndex, waymark: snapshot.waymark, unseenSince, element };
  }
  return unsighted(stepAt(walkthrough, entry.step), entry.step);
}

/** The Run's definition for this id; another under an id already taken is a mistake, thrown in development. */
export function canonical(model: Model, walkthrough: Walkthrough): Walkthrough {
  const known = model.definitions.get(walkthrough.id);
  if (known === undefined || known === walkthrough) return walkthrough;
  if (inDevelopment()) {
    throw new Error(
      `Walkthrough "${walkthrough.id}" was handed to the Run by two different definitions. Define each walkthrough once, outside render, and give each its own id.`,
    );
  }
  return known;
}

/**
 * A walkthrough's progress once it shows `shown`: `was` itself when the
 * step, the phase and whether it is collapsed are unchanged, so identity
 * means "nothing to save", and a machine stays keyed to its entry.
 */
export function entryOf(shown: Snapshot, was: WalkthroughProgress | undefined, now: number): WalkthroughProgress {
  // TODO, as `record` today:
  // status = running | completed→finished | exited; collapsed = running && shown.collapsed
  // same status, step, stepCount and collapsed as `was` → was
  // else { status, step: shown.stepIndex, stepCount: shown.stepCount, collapsed, changedAt: now }
  throw new Error("not implemented");
}

/**
 * A walkthrough's entry in a record saved elsewhere: kept as this Run has it
 * when it is open here or this Run changed it since, and collapsed when it
 * is open there, so only one is open here.
 */
export function heardEntry(
  model: Model,
  id: string,
  heard: WalkthroughProgress | undefined,
): WalkthroughProgress | undefined {
  // TODO, as today, with `openId(model) === id` for `machine?.walkthrough.id === id`.
  throw new Error("not implemented");
}

export const momentOf = (model: Model): Moment => ({ statuses: model.statuses, progress: model.progress });

/** What checklists are drawn from. */
export type Seen = Moment & Readonly<{ open: string | undefined; storageStatus: StorageStatus }>;

export const seenOf = (model: Model): Seen => ({ ...momentOf(model), open: openId(model), storageStatus: model.storageStatus });

/**
 * What the Run last showed. Kept so that a part that has not changed keeps
 * its identity, which is how a listener knows there is nothing to redraw.
 * Every field is worked out from the Model; none is read back into it.
 */
export type Shown = Readonly<{
  snapshot: RunSnapshot;
  open: OpenWalkthrough | null;
  /** The last Beacon drawn for each walkthrough. */
  beacons: ReadonlyMap<string, Beacon>;
  /** Worked out once per change, for every checklist view. */
  seen: Seen;
}>;

/** What the Run shows now, reusing each part of `previous` that has not changed. */
export function show(previous: Shown | undefined, model: Model): Shown {
  // TODO, today's `build`, `openNow` and `beaconsNow` as one pure function:
  // machine = machineOf(model)
  // open: machine running → { walkthrough, snapshot: machine.state.snapshot,
  //   task: first of model.tasks whose walkthrough is machine's }, reusing previous.open when all three are the same
  // beacons: from candidates(model); only `found` ones, and the latest by
  //   changedAt also when absent, lost or missing; each reuses previous.beacons
  //   when walkthrough, stepIndex and waymark are the same; the array reuses
  //   previous.snapshot.beacons when every element is the same
  // snapshot: reuses previous.snapshot when storageStatus, progress, open and beacons are the same
  // seen: seenOf(model)
  throw new Error("not implemented");
}
