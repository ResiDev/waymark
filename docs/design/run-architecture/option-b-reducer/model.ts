// Sketch: packages/core/src/run/model.ts (~190 lines implemented)
// The core's vocabulary: the one value it works on, what goes in, what comes out.
// Types only, plus the Draft helpers every transition uses. Imports no transition.

import type { Moment } from "../checklists/tasks";
import type {
  AnyTask,
  ChecklistDefinition,
  ChecklistGroup,
  ChecklistSnapshot,
  DefinedTask,
  StorageStatus,
} from "../checklists/types";
import type { WaymarkProblem } from "../problems";
import type { Parsed, Read, StoredChanges } from "../storage/records";
import type { Walkthrough } from "../walkthrough/types";
import type { LiveWatchers, Message, Sighting, WaymarkRead } from "./rules";
import type { State } from "./state";
import type { Action, RunEvent, RunSnapshot, WaymarkEvent } from "./types";

// The state

/**
 * Everything the Run knows, as one value. Only `commit` and the edits in
 * `core.ts` make a new one, and the shell holds the latest. It holds the
 * app's definitions and page elements as references, which the core compares
 * but never calls: author code runs in the shell, before a change.
 */
export type RunState = Readonly<{
  known: Known;
  /** The user's record. Entries are replaced, never changed in place, so identity says what a change changed. */
  record: Moment;
  /** Progress from storage not yet checked against its definition. Never holds the open walkthrough's id. */
  restored: ReadonlySet<string>;
  storageStatus: StorageStatus;
  /**
   * The open walkthrough. `seat` is its one writer and writes its progress
   * entry with it, so the two cannot disagree. Between changes it is running
   * and not collapsed: `settle` lets go of any other.
   */
  open: Machine | undefined;
  /** From `requestStart`, oldest first. */
  waiting: readonly Walkthrough[];
  /** The step generation of the last step shown, which the next walkthrough's steps follow. */
  lastGeneration: number;
  /** Where each collapsed walkthrough's Waymark is, while none is open. */
  sightings: ReadonlyMap<string, Sighting>;
  /** The checklist whose Start began each running walkthrough, so a skip from its popover names it. */
  startedFrom: ReadonlyMap<string, string>;
}>;

/** What the app has handed over. Grows only, never saved, and changes no snapshot by itself. */
export type Known = Readonly<{
  /** The first definition of each id. */
  walkthroughs: ReadonlyMap<string, Walkthrough>;
  /** The first definition of each id, in the order they reached the Run: the order checklist events go in. */
  tasks: ReadonlyMap<string, DefinedTask>;
  /** Groups whose Tasks have been taken in, so each is taken in once. */
  groups: ReadonlySet<ChecklistGroup>;
}>;

/** The open walkthrough and its State, the one thing `rules.ts` works on. */
export type Machine = Readonly<{
  walkthrough: Walkthrough;
  state: State;
  /** Its first look has gone out since it opened or the Run last attached. */
  looked: boolean;
}>;

/**
 * The snapshots last published. Kept beside the state, not in it, so no
 * transition can read them: they decide identity, never behaviour.
 */
export type Shown = Readonly<{
  run: RunSnapshot;
  /** Every checklist that has reached the Run, in the order it did: the order `checklistComplete` goes in. */
  checklists: ReadonlyMap<ChecklistDefinition<AnyTask>, ChecklistSnapshot<AnyTask>>;
}>;

/** What the shell holds of the core: the state, and what was last published from it. */
export type Model = Readonly<{ state: RunState; shown: Shown }>;

// What goes in

/** What the shell reads from outside as each change begins, so the core never asks the clock or the page. */
export type World = Readonly<{
  /** `Date.now()`, once per change: when progress changed, and what restored progress is aged against. */
  now: number;
  /** A renderer is attached, read live, as a walkthrough opening while attached starts attached. */
  attached: boolean;
}>;

/**
 * Each due condition's answer, from `isComplete`, which the shell calls just
 * before the change. `undefined`: no context, or a condition threw and the
 * shell has reported it, so nothing is recorded.
 */
export type Verdicts = ReadonlyMap<string, boolean> | undefined;

export type TaskCommand = "markDone" | "markTodo" | "skip" | "toggle";

/**
 * One change. Every target is resolved by the shell when the command is
 * given, as today: `act` on "the open one" means the one open then.
 * Whether a change is silent or saved follows from its kind (`flagsOf`).
 */
export type Command =
  | Readonly<{ kind: "start"; walkthrough: Walkthrough; checklist?: string }>
  | Readonly<{ kind: "request"; walkthrough: Walkthrough }>
  | Readonly<{ kind: "act"; action: Action; walkthrough: Walkthrough }>
  | Readonly<{ kind: "reset"; walkthrough: Walkthrough }>
  /** For the open walkthrough's machine: reads, clicks, keys, Waymark events, its `start`. */
  | Readonly<{ kind: "message"; message: Message }>
  | Readonly<{ kind: "attach"; attached: boolean }>
  /** What the frame loop measured of each beacon's Waymark, by walkthrough id. */
  | Readonly<{ kind: "beaconReads"; reads: ReadonlyMap<string, WaymarkRead>; now: number }>
  | Readonly<{ kind: "task"; command: TaskCommand; id: string; checklist: string | undefined }>
  /** Definitions meet their restored progress, then conditions are checked. `hear` passes none. Silent. */
  | Readonly<{ kind: "arrive"; walkthroughs: "all" | readonly Walkthrough[]; verdicts: Verdicts }>
  | Readonly<{ kind: "context"; verdicts: Verdicts }>
  /** Silent and not saved: storage already holds it. */
  | Readonly<{ kind: "loaded"; read: Parsed<Read> | "failed" }>
  /** A record saved elsewhere, already parsed. Silent and not saved. */
  | Readonly<{ kind: "heard"; read: Read | null }>;

// What comes out

/**
 * What the shell does once the state is in, in this order, which is the
 * order the core lists them in. The shell interprets; it never reorders.
 */
export type Effect =
  | Readonly<{ kind: "scroll"; to: Element }>
  /** The page watchers the state wants. The shell opens and closes to match. Always sent: a fired frame must be asked for again. */
  | Readonly<{ kind: "watch"; wanted: LiveWatchers }>
  /** The open walkthrough's first look, then `start`. Measuring runs the step's check, so the shell does it. */
  | Readonly<{ kind: "look"; start: Message }>
  | Readonly<{ kind: "notify"; snapshot: RunSnapshot }>
  | Readonly<{ kind: "notifyChecklist"; definition: ChecklistDefinition<AnyTask>; snapshot: ChecklistSnapshot<AnyTask> }>
  /** `record` is the whole record after the change, for `onChange`. */
  | Readonly<{ kind: "save"; changes: StoredChanges; record: Moment }>
  | Readonly<{ kind: "report"; problem: WaymarkProblem }>
  | Readonly<{ kind: "announce"; event: WaymarkEvent }>;

export type Commit = Readonly<{ model: Model; effects: readonly Effect[] }>;

// The change as it is made

/**
 * One change as it is made: the state so far and what it has to say once
 * done. Every transition takes one and hands back the next, the same object
 * when nothing changed. What used to be pushed onto arrays is carried here.
 */
export type Draft = Readonly<{
  state: RunState;
  world: World;
  events: readonly RunEvent[];
  problems: readonly WaymarkProblem[];
  /** The checklist each Task's status was changed from, for its event. */
  credits: ReadonlyMap<string, string>;
  /** Waymarks to scroll to, before anything is announced. */
  scrolls: readonly Element[];
}>;

/** The same draft when nothing in `patch` differs, so a change that changes nothing allocates nothing. */
export function edit(draft: Draft, patch: Partial<RunState>): Draft {
  // TODO: return draft if every key of patch is Object.is to draft.state's; else { ...draft, state: { ...draft.state, ...patch } }.
  throw new Error("not implemented");
}

export function say(draft: Draft, event: RunEvent): Draft {
  throw new Error("not implemented");
}

export function warn(draft: Draft, problem: WaymarkProblem): Draft {
  throw new Error("not implemented");
}

export function credit(draft: Draft, id: string, checklist: string | undefined): Draft {
  // TODO: unchanged when checklist is undefined.
  throw new Error("not implemented");
}

export function scrollTo(draft: Draft, element: Element | undefined): Draft {
  throw new Error("not implemented");
}
