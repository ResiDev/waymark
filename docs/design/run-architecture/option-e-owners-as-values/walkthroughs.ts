// Sketch for packages/core/src/run/walkthroughs.ts, about 330 lines. Not compiled.
//
// Owns: definitions, progress, restored, the open machine, waiting,
// lastGeneration. Keeps the Run's one rule: at most one walkthrough is running
// and not collapsed. Every writer of progress is in this file.
//
// Pure. The state is a value; every transition takes it and returns the next,
// the same object when nothing changed. Nothing here touches the page or calls
// the app's code.

import { dictionary } from "../dictionary";
import { recordDropped } from "../problems";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { Change } from "./change";
import { apply } from "./rules";
import type { Message, Sighting } from "./rules";
import { opening, stepAt } from "./state";
import type { State } from "./state";
import type { Action, Snapshot } from "./types";

export type Progress = Readonly<Record<string, WalkthroughProgress>>;

/** The open walkthrough and its live State, the one thing `rules.ts` works on. */
export type Machine = Readonly<{
  walkthrough: Walkthrough;
  state: State;
  /** Its first look has gone out since it opened or the Run last attached. */
  looked: boolean;
}>;

export type Walkthroughs = Readonly<{
  /** The first definition of each id. Handed over on use, never saved. */
  definitions: ReadonlyMap<string, Walkthrough>;
  /** Entries are replaced, never changed in place, so identity says what a change changed. */
  progress: Progress;
  /** Progress from storage not yet checked against its definition. Until then it waits as data. */
  restored: ReadonlySet<string>;
  /**
   * Only `seat` writes it, and it writes `progress[open.walkthrough.id]` in the
   * same step, so the two never disagree, even mid-change. Between changes it
   * is running and not collapsed: `settle` lets go of any other.
   */
  open: Machine | undefined;
  /** From `requestStart`, oldest first. */
  waiting: readonly Walkthrough[];
  /** The step generation of the last step shown, which the next walkthrough's steps follow. */
  lastGeneration: number;
}>;

/** Where a walkthrough that has just collapsed last saw its Waymark, so its beacon starts there. */
export type Left = Readonly<{ id: string; sighting: Sighting }>;

/** A collapsed walkthrough the Run can draw as a beacon. */
export type Collapsed = Readonly<{ walkthrough: Walkthrough; saved: WalkthroughProgress }>;

export const EMPTY_WALKTHROUGHS: Walkthroughs = {
  definitions: new Map(),
  progress: Object.freeze(dictionary<WalkthroughProgress>()),
  restored: new Set(),
  open: undefined,
  waiting: [],
  lastGeneration: -1,
};

// Edits: between changes, outside the queue. They change no snapshot.

/**
 * Adds a definition under an id not yet taken. `clash` when a different one
 * comes under a taken id; `run.ts` throws for it in development, at the call.
 */
export function take(
  w: Walkthroughs,
  walkthrough: Walkthrough,
): Readonly<{ walkthroughs: Walkthroughs; taken: Walkthrough; clash: boolean }> {
  throw new Error("not implemented");
}

/** Drops a request that is still waiting. Waiting requests are neither shown nor saved. */
export function withdraw(w: Walkthroughs, walkthrough: Walkthrough): Walkthroughs {
  throw new Error("not implemented");
}

// Commands: inside a change.

/** As `Run.start`: sets aside the open one, then opens this one where it was, or afresh. */
export function start(w: Walkthroughs, walkthrough: Walkthrough, change: Change): Walkthroughs {
  // TODO, as `begin` today, after `arrive`:
  // unwaited = drop it from waiting; already open → unwaited
  // next = interrupt(unwaited, walkthrough.id, change)
  // saved running → open(next, walkthrough, saved.step, saved.collapsed ? "resume" : "restore", change)
  // else → open(next, walkthrough, 0, "fresh", change)
  throw new Error("not implemented");
}

/** As `Run.requestStart`: opens now if nothing is open, else waits; nothing if it has progress. */
export function request(w: Walkthroughs, walkthrough: Walkthrough, change: Change): Walkthroughs {
  throw new Error("not implemented");
}

/** As `Run.act` and `Run.reset`. One that is not open takes only `resume`, `reset` and `exit`. */
export function act(w: Walkthroughs, walkthrough: Walkthrough, action: Action, change: Change): Walkthroughs {
  throw new Error("not implemented");
}

/** A message for the open machine, from the page. What `rules.ts` says becomes the change's events, problems and scroll. */
export function obey(w: Walkthroughs, message: Message, change: Change): Walkthroughs {
  const machine = w.open;
  if (machine === undefined) return w;
  const { walkthrough, state } = machine;
  const from = state.snapshot;
  const outcome = apply(state, message, walkthrough);
  if (outcome.scrollTo !== undefined) change.scrollTo(outcome.scrollTo);
  const next = outcome.state === state ? w : seat(w, { ...machine, state: outcome.state }, change);
  if (from.phase !== "running") return next;
  const { id } = walkthrough;
  const { step, stepIndex } = from;
  if (outcome.waymarkGone !== undefined) {
    change.problem({ type: outcome.waymarkGone === "lost" ? "waymarkLost" : "waymarkMissing", walkthrough: id, step, stepIndex });
  }
  for (const type of outcome.events) change.event({ type, walkthrough: id, step, stepIndex, snapshot: outcome.state.snapshot });
  return next;
}

/**
 * A definition meets its restored progress: dropped if it cannot be picked up
 * again, and, if it was open, open again, or set aside as if interrupted when
 * another is.
 */
export function arrive(w: Walkthroughs, walkthrough: Walkthrough, change: Change): Walkthroughs {
  // TODO, as today, with change.now for staleness and changedAt, and change.problem(recordDropped(...)).
  throw new Error("not implemented");
}

/** A renderer starts or stops drawing the Run. Detached, the next attach gets a first look again. */
export function setAttached(w: Walkthroughs, attached: boolean, change: Change): Walkthroughs {
  // TODO: obey({ kind: attached ? "attached" : "detached" }); on detach, seat with looked: false.
  throw new Error("not implemented");
}

// The record

/** The record loaded at start, in place of what is held. Every entry waits in `restored` for its definition. */
export function restore(w: Walkthroughs, progress: Progress): Walkthroughs {
  throw new Error("not implemented");
}

/**
 * A record saved elsewhere, such as in another tab. Each entry is kept as
 * this Run has it when it is open here or this Run changed it since, and
 * collapsed when it is open there, so only one is open here.
 */
export function hear(w: Walkthroughs, heard: Progress): Walkthroughs {
  // TODO: today's `hear` loop over heardEntry, building one new progress only if an entry moved;
  // an entry whose definition has not arrived goes into `restored`, as a loaded one does.
  throw new Error("not implemented");
}

// The pipeline's steps. Only `settle` in model.ts calls them.

/**
 * At the end of every change: lets go of an open walkthrough that collapsed
 * or ended, then opens the next waiting request if nothing is open. Hands back
 * where one that has just collapsed last saw its Waymark.
 */
export function settle(w: Walkthroughs, change: Change): readonly [Walkthroughs, Left | undefined] {
  // TODO:
  // [released, left] = release(w)
  // released.open !== undefined → [released, left]
  // first = waiting.find((x) => progress[x.id] === undefined)  — one started, finished or exited since is dropped
  // waiting = first === undefined ? [] : waiting.slice(indexOf(first) + 1)
  // first → [open(…, first, 0, "fresh", change), undefined]: another opened, so nothing is left to show
  throw new Error("not implemented");
}

/** The open machine's first look, once it is drawn. `run.ts` hands the message to the page after the watchers are in. */
export function firstLook(w: Walkthroughs): readonly [Walkthroughs, Message | undefined] {
  // TODO: none open, looked, or not attached → [w, undefined]
  // else [w with open.looked = true, { kind: "start", stepGeneration: open.state.stepGeneration }]
  // The fix for the first-look bug lands here: due while !state.started, not only while !looked.
  throw new Error("not implemented");
}

// Reads

/** None while a walkthrough is open, and none whose progress waits for its definition. */
export function collapsed(w: Walkthroughs): readonly Collapsed[] {
  throw new Error("not implemented");
}

// Private

/** The one writer of `open`, and of the open walkthrough's progress entry with it. */
function seat(w: Walkthroughs, machine: Machine | undefined, change: Change): Walkthroughs {
  // TODO: machine === w.open → w
  // next = { ...w, open: machine }; machine === undefined ? next : put(next, machine.walkthrough.id, entryOf(machine.state.snapshot, …, change.now))
  throw new Error("not implemented");
}

/** A copy of progress with one entry replaced or, for `undefined`, gone. The same object when nothing changes. */
function put(w: Walkthroughs, id: string, entry: WalkthroughProgress | undefined): Walkthroughs {
  throw new Error("not implemented");
}

/** A new entry only when the step, the phase or whether it is collapsed changed. */
function entryOf(shown: Snapshot, was: WalkthroughProgress | undefined, now: number): WalkthroughProgress {
  throw new Error("not implemented");
}

function open(
  w: Walkthroughs,
  walkthrough: Walkthrough,
  index: number,
  how: "fresh" | "resume" | "restore",
  change: Change,
): Walkthroughs {
  // TODO: state = opening(walkthrough, index, { stepGeneration: w.lastGeneration, attached: change.attached, resumed: how !== "fresh" })
  // next = seat(w, { walkthrough, state, looked: false }, change); "resume" → change.event(resume …)
  throw new Error("not implemented");
}

/** Lets go of the open walkthrough once it is collapsed or ended, carrying its step generation on. */
function release(w: Walkthroughs): readonly [Walkthroughs, Left | undefined] {
  throw new Error("not implemented");
}

/** Sets the open walkthrough aside as its `dismiss` says, for the one started over it, and says `interrupt`. */
function interrupt(w: Walkthroughs, by: string, change: Change): Walkthroughs {
  throw new Error("not implemented");
}
