// Sketch: packages/core/src/run/schedule.ts (~280 lines implemented)
// Which walkthrough is where: the open one, those waiting, those collapsed
// behind beacons, and how far the user is through each. The one writer of
// `open`, `record.progress`, `restored`, `waiting`, `lastGeneration` and
// `sightings`. Every transition takes the change so far and hands back the
// next, the same object when nothing changed. Nothing here calls the app's code.

import { recordDropped } from "../problems";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { edit, say, scrollTo, warn } from "./model";
import type { Draft, Machine, RunState } from "./model";
import { apply, sight, unsighted } from "./rules";
import type { Message, WaymarkRead } from "./rules";
import { collapsedNow } from "./select";
import { opening, stepAt } from "./state";
import type { Action, Ended, Snapshot } from "./types";

type Progress = Readonly<Record<string, WalkthroughProgress>>;

// The open walkthrough

/**
 * The one writer of `open`. A machine is seated with its progress entry
 * written beside it, so `progress[open.id]` always says what the machine
 * shows. Letting go (`undefined`) writes nothing: the entry is already in.
 */
function seat(draft: Draft, machine: Machine | undefined): Draft {
  // TODO: if machine === draft.state.open -> draft.
  // next = edit(draft, { open: machine }); machine === undefined ? next : record(next, machine.walkthrough.id, machine.state.snapshot).
  throw new Error("not implemented");
}

/** A new entry only when the step, the phase or whether it is collapsed changed, stamped with the change's time. */
function record(draft: Draft, id: string, shown: Snapshot): Draft {
  // TODO: as run.ts `record` today, with draft.world.now for changedAt; setProgress(draft, id, entry).
  throw new Error("not implemented");
}

/** A copy of progress with one entry replaced or, for `undefined`, gone. */
function setProgress(draft: Draft, id: string, value: WalkthroughProgress | undefined): Draft {
  // TODO: edit(draft, { record: { ...record, progress: next } }); unchanged when record.progress[id] === value.
  throw new Error("not implemented");
}

/** A walkthrough already part way through opens as it was, and sends no `start` when drawn. */
function open(draft: Draft, walkthrough: Walkthrough, index: number, how: "fresh" | "resume" | "restore"): Draft {
  // TODO:
  // state = opening(walkthrough, index, { stepGeneration: lastGeneration, attached: draft.world.attached, resumed: how !== "fresh" })
  // next = seat(draft, { walkthrough, state, looked: false })
  // how === "resume" -> say(next, resume event at stepAt(walkthrough, index), snapshot state.snapshot)
  throw new Error("not implemented");
}

/** Lets go of the open walkthrough once it is collapsed or ended. Its beacon starts where it last saw its Waymark. */
function release(draft: Draft): Draft {
  // TODO:
  // machine = open; none, or running and not collapsed -> draft.
  // running (so collapsed) -> sightings.set(id, { stepIndex, waymark, unseenSince: state.unseenSince, element: state.element }).
  // lastGeneration = state.stepGeneration; seat(next, undefined).
  throw new Error("not implemented");
}

/** At the end of every change: when nothing is open, a waiting request goes before the beacons show. */
export function settle(draft: Draft): Draft {
  // TODO:
  // next = release(draft)
  // if next.state.open === undefined:
  //   first = waiting.find((w) => progress[w.id] === undefined)  — one since started, finished or exited is dropped
  //   waiting = first === undefined ? [] : waiting.slice(indexOf(first) + 1); first && open(first, 0, "fresh")
  // A beacon's Waymark is looked for afresh each time it shows: it may have moved while another was open.
  // sightings = for each [w, saved] of collapsedNow(state):
  //   kept = sightings.get(w.id); kept?.stepIndex === saved.step ? kept : unsighted(stepAt(w, saved.step), saved.step)
  // The same map when every entry is kept and none went, so a frame while one is open allocates no map.
  throw new Error("not implemented");
}

/** A message for the open walkthrough's machine. What `rules.ts` says becomes this change's events, problems and scroll. */
export function obey(draft: Draft, message: Message): Draft {
  const machine = draft.state.open;
  if (machine === undefined) return draft;
  const { walkthrough, state } = machine;
  const from = state.snapshot;
  const outcome = apply(state, message, walkthrough);
  let next = outcome.state === state ? draft : seat(draft, { ...machine, state: outcome.state });
  next = scrollTo(next, outcome.scrollTo);
  if (from.phase !== "running") return next;
  const { id } = walkthrough;
  const { step, stepIndex } = from;
  if (outcome.waymarkGone !== undefined) {
    const type = outcome.waymarkGone === "lost" ? "waymarkLost" : "waymarkMissing";
    next = warn(next, { type, walkthrough: id, step, stepIndex });
  }
  for (const type of outcome.events) {
    next = say(next, { type, walkthrough: id, step, stepIndex, snapshot: outcome.state.snapshot });
  }
  return next;
}

/** Sets the open walkthrough aside as its `dismiss` says, for the one started over it. */
function interrupt(draft: Draft, by: string): Draft {
  // TODO: as run.ts today: not running -> draft; seat with apply(act dismiss ?? "collapse").state,
  // ignoring its events; say interrupt (interruptedBy: by); release.
  throw new Error("not implemented");
}

/** The open walkthrough's first look, decided as the change ends and sent by the shell after `watch`. */
export function firstLook(draft: Draft): Readonly<{ draft: Draft; start?: Message }> {
  const machine = draft.state.open;
  if (machine === undefined || machine.looked || !machine.state.attached) return { draft };
  return {
    draft: seat(draft, { ...machine, looked: true }),
    start: { kind: "start", stepGeneration: machine.state.stepGeneration },
  };
}

// Commands

/**
 * A walkthrough's definition meets its restored progress: dropped if it
 * cannot be picked up again, and, if it was open, open again, or set aside as
 * if interrupted when another is.
 */
export function arrive(draft: Draft, walkthrough: Walkthrough): Draft {
  // TODO: as run.ts today, with `restored` copied on delete:
  // not in restored -> draft. saved undefined -> drop from restored.
  // reason = staleness(saved, steps.length, maxAge ?? DEFAULT_MAX_AGE, world.now):
  //   setProgress(id, undefined) then warn(recordDropped(id, reason)) — dropped before the handler hears,
  //   so a walkthrough it starts keeps its progress.
  // not running, or collapsed -> done. open undefined -> open(saved.step, "restore");
  // dismiss "exit" -> { ...saved, status: "exited", changedAt: now }; else { ...saved, collapsed: true, changedAt: now }.
  throw new Error("not implemented");
}

export function begin(draft: Draft, walkthrough: Walkthrough): Draft {
  const unwaited = edit(draft, { waiting: without(draft.state.waiting, walkthrough) });
  if (unwaited.state.open?.walkthrough.id === walkthrough.id) return unwaited;
  const next = interrupt(unwaited, walkthrough.id);
  const saved = next.state.record.progress[walkthrough.id];
  return saved?.status === "running"
    ? open(next, walkthrough, saved.step, saved.collapsed ? "resume" : "restore")
    : open(next, walkthrough, 0, "fresh");
}

export function request(draft: Draft, walkthrough: Walkthrough): Draft {
  // TODO: progress[id] defined, or already waiting -> draft; nothing open -> open(0, "fresh"); else waiting + walkthrough.
  throw new Error("not implemented");
}

export function resetOne(draft: Draft, walkthrough: Walkthrough): Draft {
  // TODO: open is it -> obey(act reset). Else drop id from restored and from progress.
  throw new Error("not implemented");
}

export function actOn(draft: Draft, walkthrough: Walkthrough, action: Action): Draft {
  if (action === "reset") return resetOne(draft, walkthrough);
  const arrived = arrive(draft, walkthrough);
  if (arrived.state.open?.walkthrough.id === walkthrough.id) return obey(arrived, { kind: "act", action });
  if (action === "resume") return begin(arrived, walkthrough);
  const saved = arrived.state.record.progress[walkthrough.id];
  if (action !== "exit" || saved?.status !== "running") return arrived;
  const ended: Ended = { phase: "exited", stepIndex: saved.step, stepCount: saved.stepCount };
  const step = stepAt(walkthrough, saved.step);
  const exited = record(arrived, walkthrough.id, ended);
  return say(exited, { type: "exit", walkthrough: walkthrough.id, step, stepIndex: saved.step, snapshot: ended });
}

/** The page's eyes open or close. Nobody looked while detached, so that time counts towards neither missing nor lost. */
export function setAttached(draft: Draft, attached: boolean): Draft {
  // TODO: next = obey(draft, { kind: attached ? "attached" : "detached" }); attached -> next.
  // Detached: open (if any) seated with looked: false, so it is looked at again on attaching;
  // every sighting { ...s, unseenSince: undefined }.
  throw new Error("not implemented");
}

/** What the frame loop measured of each beacon's Waymark, while none is open. */
export function sightBeacons(draft: Draft, reads: ReadonlyMap<string, WaymarkRead>, now: number): Draft {
  // TODO: for each [id, read]: previous = sightings.get(id), w = known.walkthroughs.get(id), saved = progress[id];
  // skip unless all three are there; next = sight(previous, read, now, stepAt(w, saved.step)).
  // A new map only when some sighting is new, which `sight` already makes rare.
  throw new Error("not implemented");
}

// The record from outside

/** The record loaded: every entry waits in `restored` until its definition arrives. Nothing can be open yet. */
export function restore(draft: Draft, progress: Progress): Draft {
  // TODO: record.progress = progress; restored = new Set(Object.keys(progress)).
  throw new Error("not implemented");
}

/**
 * A record saved elsewhere: each entry as `heardEntry` says. One whose
 * definition has not arrived waits to be checked, as one loaded does.
 */
export function hear(draft: Draft, heard: Progress): Draft {
  // TODO: as run.ts `hear`'s first change today, over the union of ids; a new progress object only when an entry moved.
  throw new Error("not implemented");
}

/**
 * Kept as this Run has it when it is open here or this Run changed it since,
 * and collapsed when it is open there, so only one is open here.
 */
function heardEntry(state: RunState, id: string, heard: WalkthroughProgress | undefined): WalkthroughProgress | undefined {
  // TODO: moved unchanged from run.ts, reading state.open and state.record.progress.
  throw new Error("not implemented");
}

/** For `withdraw`, between changes. */
export function unwait(state: RunState, walkthrough: Walkthrough): RunState {
  const waiting = without(state.waiting, walkthrough);
  return waiting === state.waiting ? state : { ...state, waiting };
}

const without = <T>(list: readonly T[], item: T): readonly T[] => {
  const at = list.indexOf(item);
  return at === -1 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
};
