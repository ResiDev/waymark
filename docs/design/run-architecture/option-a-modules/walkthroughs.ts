// packages/core/src/run/walkthroughs.ts — about 340 lines.
//
// Owns: `definitions`, `progress`, `restored`, the machine, `waiting`,
// `lastGeneration`.
//
// Keeps the Run's one rule: at most one walkthrough is running and not
// collapsed. Every writer of progress lives here, so every way that rule can be
// broken is in this file: starting over an open one, a request going first, a
// restored one arriving, another tab's record being heard. Nothing here touches
// the page.

import { inDevelopment } from "../dev";
import { dictionary } from "../dictionary";
import { recordDropped } from "../problems";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { Change, Durable } from "./change";
import { apply } from "./rules";
import type { Message, Sighting } from "./rules";
import { opening, stepAt } from "./state";
import type { State } from "./state";
import type { Action, Ended, OpenWalkthrough, Snapshot } from "./types";

export type Progress = Readonly<Record<string, WalkthroughProgress>>;

export const NO_PROGRESS: Progress = Object.freeze(dictionary<WalkthroughProgress>());

/**
 * The open walkthrough and its live State, for the page to read. The same
 * object for as long as it stays open, so identity says "the same opening".
 */
export type OpenMachine = Readonly<{ walkthrough: Walkthrough; state: State }>;

/** A collapsed walkthrough the Run can draw as a beacon. */
export type Collapsed = Readonly<{ walkthrough: Walkthrough; saved: WalkthroughProgress }>;

/** Where a walkthrough that has just collapsed last saw its Waymark, so its beacon starts there. */
export type Left = Readonly<{ id: string; sighting: Sighting }>;

export type Walkthroughs = Readonly<{
  /**
   * The Run's definition for this id; another under an id already taken is a
   * mistake. Not a change: nothing about a definition is shown or saved until
   * a command acts on it.
   */
  take: (walkthrough: Walkthrough) => Walkthrough;
  /** Drops a request that is still waiting. Not a change: waiting requests are neither shown nor saved. */
  withdraw: (walkthrough: Walkthrough) => void;

  // Commands. Each first checks the walkthrough against its restored progress.

  /** As `Run.start`: set aside the open one, then open this one where it was, or afresh. */
  start: (change: Change, walkthrough: Walkthrough) => void;
  /** As `Run.requestStart`: open now if nothing is, else wait; nothing if it has progress. */
  request: (change: Change, walkthrough: Walkthrough) => void;
  /** As `Run.act` and `Run.reset`. One that is not open takes only `resume`, `reset` and `exit`. */
  act: (change: Change, walkthrough: Walkthrough, action: Action) => void;
  /**
   * A message for the open walkthrough's machine, from the page. Hands back
   * the Waymark to scroll to, which the page does: nothing here touches it.
   */
  obey: (change: Change, message: Message) => Element | undefined;
  /** Definitions that have just reached the Run meet their restored progress, as a checklist's do when it is first used. */
  arrive: (change: Change, walkthroughs: Iterable<Walkthrough>) => void;

  // The pipeline's step. Only `commit` calls it.

  /**
   * At the end of every change: lets go of an open walkthrough that collapsed
   * or ended, opens the next waiting request if nothing is open, and brings
   * the open walkthrough's entry up to date. Hands back where one that has
   * just collapsed last saw its Waymark, when nothing else opened.
   */
  settle: (change: Change) => Left | undefined;

  // Reads.

  /** A new object only after a change to it, so identity says what to save. */
  progress: () => Progress;
  open: () => OpenMachine | undefined;
  /** None while a walkthrough is open, and none whose progress waits for its definition. */
  collapsed: () => readonly Collapsed[];
  /** The snapshot's `open`: `previous` itself when nothing in it changed. */
  shown: (previous: OpenWalkthrough | null, taskOf: (walkthrough: string) => string | null) => OpenWalkthrough | null;

  /** Its part of the record: `walkthroughs`. */
  record: Durable;
}>;

/** The only mutable shape of the machine. Never handed out but as `OpenMachine`. */
type Machine = { readonly walkthrough: Walkthrough; state: State };

const NO_COLLAPSED: readonly Collapsed[] = Object.freeze([]);

/**
 * `attached` is read as a walkthrough opens, so its State starts attached or
 * not as the page is at that moment. The page's attachments own the answer.
 */
export function createWalkthroughs({ attached }: Readonly<{ attached: () => boolean }>): Walkthroughs {
  /** Handed over as each walkthrough is used, and never saved. */
  const definitions = new Map<string, Walkthrough>();
  let progress: Progress = NO_PROGRESS;
  /** Progress from storage not yet checked against its definition. Until then it waits as data. */
  const restored = new Set<string>();
  let machine: Machine | undefined;
  /** From `requestStart`, oldest first. */
  const waiting: Walkthrough[] = [];
  /** The step generation of the last step shown, which the next walkthrough's steps follow. Read only while nothing is open. */
  let lastGeneration = -1;

  /**
   * Writes the entry of a walkthrough that is not open. The open one's is
   * written by `project` alone.
   */
  const put = (id: string, entry: WalkthroughProgress | undefined): void => {
    // TODO: copy-on-write, as `setProgress` today; nothing when `progress[id] === entry`.
    // In development, throw if `machine?.walkthrough.id === id`: that write belongs to `project`.
    throw new Error("not implemented");
  };

  /**
   * The open walkthrough's entry, as its State shows it: the one write to it.
   * Run as the open walkthrough is let go and at the end of every change, so
   * between changes the entry is never behind the machine. Inside a change,
   * read the machine, not the entry.
   */
  const project = (): void => {
    // TODO: if (machine) write progress[id] = entryFor(progress[id], machine.state.snapshot), copy-on-write when it differs.
    throw new Error("not implemented");
  };

  /** A walkthrough already part way through opens as it was, and sends no `start` when drawn. Its entry follows at `project`. */
  const openAt = (change: Change, walkthrough: Walkthrough, index: number, how: "fresh" | "resume" | "restore"): void => {
    // TODO:
    // const state = opening(walkthrough, index, { stepGeneration: lastGeneration, attached: attached(), resumed: how !== "fresh" });
    // machine = { walkthrough, state };
    // if (how === "resume") change.event({ type: "resume", walkthrough: walkthrough.id, step: stepAt(walkthrough, index), stepIndex: index, snapshot: state.snapshot });
    throw new Error("not implemented");
  };

  /** Brings the open walkthrough's entry up to date, and lets go of it once it is no longer open. */
  const release = (): Left | undefined => {
    // TODO:
    // if (machine === undefined) return undefined;
    // project();
    // const { walkthrough, state } = machine; const shown = state.snapshot;
    // if (shown.phase === "running" && !shown.collapsed) return undefined;
    // lastGeneration = state.stepGeneration;
    // machine = undefined;
    // // Its beacon starts where the walkthrough last saw its Waymark.
    // return shown.phase === "running"
    //   ? { id: walkthrough.id, sighting: { stepIndex: shown.stepIndex, waymark: shown.waymark, unseenSince: state.unseenSince, element: state.element } }
    //   : undefined;
    throw new Error("not implemented");
  };

  /**
   * Sets the open walkthrough aside as its `dismiss` says, for the one started
   * over it. Where it last saw its Waymark is not kept: the one started over it
   * opens, and no beacon shows while one is open.
   */
  const interrupt = (change: Change, by: string): void => {
    // TODO: as today:
    // if (!machine || machine.state.snapshot.phase !== "running") return;
    // machine.state = apply(state, { kind: "act", action: walkthrough.dismiss ?? "collapse" }, walkthrough).state;
    // change.event({ type: "interrupt", walkthrough: id, step: from.step, stepIndex: from.stepIndex, snapshot: machine.state.snapshot, interruptedBy: by });
    // release();
    throw new Error("not implemented");
  };

  /**
   * A walkthrough's definition meets its restored progress: dropped if it
   * cannot be picked up again, and, if it was open, open again, or set aside as
   * if interrupted when another is. Once per restored entry: `restored` forgets
   * it as it is checked, so running it twice is the same as once.
   */
  const arriveOne = (change: Change, walkthrough: Walkthrough): void => {
    // TODO: as `arrive` today:
    // if (!restored.delete(id)) return;
    // const saved = progress[id]; if (saved === undefined) return;
    // const reason = staleness(saved, walkthrough.steps.length, walkthrough.maxAge ?? DEFAULT_MAX_AGE);
    // if (reason !== undefined) {
    //   // Dropped before the handler hears, so a walkthrough it starts keeps its progress.
    //   put(id, undefined); change.problem(recordDropped(id, reason)); return;
    // }
    // if (saved.status !== "running" || saved.collapsed) return;
    // if (machine === undefined) openAt(change, walkthrough, saved.step, "restore");
    // else if (walkthrough.dismiss === "exit") put(id, { ...saved, status: "exited", changedAt: Date.now() });
    // else put(id, { ...saved, collapsed: true, changedAt: Date.now() });
    throw new Error("not implemented");
  };

  const begin = (change: Change, walkthrough: Walkthrough): void => {
    // TODO: as today: drop it from `waiting`; nothing if it is the open one;
    // interrupt(change, walkthrough.id); then open it at its running step
    // ("resume" if collapsed, else "restore"), or afresh at 0.
    throw new Error("not implemented");
  };

  const reset = (change: Change, walkthrough: Walkthrough): void => {
    // TODO: the open one goes back to step 1 through its machine:
    //   obey(change, { kind: "act", action: "reset" });
    // any other is forgotten: restored.delete(id); put(id, undefined).
    throw new Error("not implemented");
  };

  /**
   * A walkthrough's entry in a record saved elsewhere: kept as this Run has it
   * when it is open here or this Run changed it since, and collapsed when it
   * is open there, so only one is open here.
   */
  const heardEntry = (id: string, heard: WalkthroughProgress | undefined): WalkthroughProgress | undefined => {
    // TODO: as today, `ours` when unchanged so identity says nothing moved.
    throw new Error("not implemented");
  };

  const obey = (change: Change, message: Message): Element | undefined => {
    // TODO: as `obey` today, but the scroll is handed back, not done:
    // if (!machine) return undefined;
    // const from = machine.state.snapshot;
    // const outcome = apply(machine.state, message, machine.walkthrough);
    // machine.state = outcome.state;
    // if (from.phase === "running") {
    //   if (outcome.waymarkGone) change.problem({ type: waymarkLost | waymarkMissing, walkthrough: id, step: from.step, stepIndex: from.stepIndex });
    //   for (const type of outcome.events) change.event({ type, walkthrough: id, step: from.step, stepIndex: from.stepIndex, snapshot: outcome.state.snapshot });
    // }
    // return outcome.scrollTo;
    throw new Error("not implemented");
  };

  return {
    take: (walkthrough) => {
      // TODO: as `take` today, with its development throw.
      throw new Error("not implemented");
    },
    withdraw: (walkthrough) => {
      // TODO: splice it out of `waiting` if there.
      throw new Error("not implemented");
    },
    start: (change, walkthrough) => {
      // TODO: arriveOne(change, walkthrough); begin(change, walkthrough);
      throw new Error("not implemented");
    },
    request: (change, walkthrough) => {
      // TODO:
      // arriveOne(change, walkthrough);
      // if (progress[id] !== undefined || waiting.includes(walkthrough)) return;
      // if (machine === undefined) openAt(change, walkthrough, 0, "fresh"); else waiting.push(walkthrough);
      throw new Error("not implemented");
    },
    act: (change, walkthrough, action) => {
      // TODO: as `actOn` today:
      // if (action === "reset") { reset(change, walkthrough); return; }
      // arriveOne(change, walkthrough);
      // if (machine?.walkthrough.id === id) { obey(change, { kind: "act", action }); return; }
      // if (action === "resume") { begin(change, walkthrough); return; }
      // const saved = progress[id];
      // if (action !== "exit" || saved?.status !== "running") return;
      // const ended: Ended = { phase: "exited", stepIndex: saved.step, stepCount: saved.stepCount };
      // put(id, entryFor(saved, ended));
      // change.event({ type: "exit", walkthrough: id, step: stepAt(walkthrough, saved.step), stepIndex: saved.step, snapshot: ended });
      throw new Error("not implemented");
    },
    obey,
    arrive: (change, walkthroughs) => {
      // TODO: for each, arriveOne(change, walkthrough).
      throw new Error("not implemented");
    },
    settle: (change) => {
      // TODO:
      // const left = release();
      // if (machine === undefined) {
      //   // A request the user has since started, finished or exited is dropped on the way.
      //   const next = waiting.find((walkthrough) => progress[walkthrough.id] === undefined);
      //   waiting.splice(0, next === undefined ? waiting.length : waiting.indexOf(next) + 1);
      //   if (next !== undefined) openAt(change, next, 0, "fresh");
      // }
      // project();
      // // One collapsed for a request that then opened shows no beacon, so keeps no place.
      // return machine === undefined ? left : undefined;
      throw new Error("not implemented");
    },
    progress: () => progress,
    open: () => machine,
    collapsed: () => {
      // TODO: as `collapsedNow` today: NO_COLLAPSED while `machine` is set; else every
      // entry running and collapsed whose definition is in `definitions` and not in `restored`.
      throw new Error("not implemented");
    },
    shown: (previous, taskOf) => {
      // TODO: as `openNow` today, with the previous snapshot's `open` as the cache in place of `openShown`:
      // if (!machine || machine.state.snapshot.phase !== "running") return null;
      // const task = taskOf(machine.walkthrough.id);
      // return previous?.walkthrough === machine.walkthrough && previous.snapshot === shown && previous.task === task
      //   ? previous : { walkthrough: machine.walkthrough, snapshot: shown, task };
      throw new Error("not implemented");
    },
    record: {
      restore: (_change, read) => {
        // TODO: progress = read?.walkthroughs ?? NO_PROGRESS; every id in it joins `restored`.
        throw new Error("not implemented");
      },
      hear: (_change, read) => {
        // TODO: as `hear` today, entry by entry through `heardEntry`:
        // const heard = read?.walkthroughs ?? NO_PROGRESS;
        // next = dictionary(); moved = false;
        // for id of the keys of both:
        //   entry = heardEntry(id, heard[id]);
        //   if (entry === progress[id]) { keep it; continue; }
        //   moved = true;
        //   if (entry === undefined) { restored.delete(id); continue; }
        //   next[id] = entry;
        //   // One whose definition has not arrived waits to be checked, as one loaded does.
        //   if (!definitions.has(id)) restored.add(id);
        // if (moved) progress = next;
        throw new Error("not implemented");
      },
      check: (change, after) => {
        // TODO: after "loaded", every definition taken while the record loaded meets it:
        //   for (const walkthrough of definitions.values()) arriveOne(change, walkthrough);
        // After "heard", nothing: an entry whose definition has not arrived waits in
        // `restored`, as a loaded one does, and one whose definition has is taken as heard.
        throw new Error("not implemented");
      },
    },
  };
}

/** The entry `shown` makes of `was`: `was` itself when the step, the phase and whether it is collapsed are unchanged. */
function entryFor(was: WalkthroughProgress | undefined, shown: Snapshot): WalkthroughProgress {
  // TODO: as `record` today, without the write.
  throw new Error("not implemented");
}
