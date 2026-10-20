// The facts a Run keeps, as types. A fact is stored once, where the Run
// learns it, and everything else is worked out from the facts when needed.
// A fact is an input the app gave once, something the browser or storage
// told once, or a latch that remembers that something happened.
//
// The facts are kept in four values, apart by how long they live and how
// often they change, as CODING_STANDARDS.md asks:
//
//   Given     what the app handed over      changes at a call, outside any change
//   Recorded  the user's record             changes per action; what is saved
//   Asked     what the app asked for        changes per action; this tab only
//   Live      what the page shows now       changes per frame; gone with the step
//
// run.ts holds one variable for each. `commit` assigns Recorded, Asked and
// Live, once per change. A call assigns Given when it hands something over,
// and Asked when a request joins or leaves the waiting list. Everything the
// Run hands out is a pure function of these, cached by the identity of its
// inputs.

import type { Stored } from "./checklists/record";
import type { ChecklistGroup, DefinedTask } from "./checklists/types";
import type { WaymarkProblem } from "./problems";
import type { ClickHit } from "./run/input";
import type { Action, Location, Rect, RunEvent } from "./run/types";
import type { RecordUnreadableError } from "./storage/records";
import type { Walkthrough, WalkthroughProgress } from "./walkthrough/types";

type WalkthroughId = string;
type TaskId = string;
type ChecklistName = string;

// ─── Given: what the app handed over ────────────────────────────────────────

/**
 * Inputs the app gives once, which nothing can work out again. Assigned at
 * the call, so a clash throws where it was made. Never saved.
 */
export type Given = Readonly<{
  /** Each walkthrough the app has used, the first definition under each id. Code, not data. */
  walkthroughs: ReadonlyMap<WalkthroughId, Walkthrough>;
  /** Each `defineChecklists` group one of whose checklists has been used, in the order they came. */
  groups: readonly ChecklistGroup[];
  /** The latest facts for completion conditions. */
  context: unknown;
}>;

// ─── Recorded: the user's record ────────────────────────────────────────────

/**
 * The user's record as this tab holds it, and what storage last said of it.
 * Entries and statuses are replaced, never changed in place, so a change
 * whose `progress` and `statuses` are the objects it began with has nothing
 * to save.
 */
export type Recorded = Readonly<{
  /** The user's place in each walkthrough they have started. Saved. */
  progress: Readonly<Record<WalkthroughId, WalkthroughProgress>>;
  /** Each Task off todo. Saved. */
  statuses: Stored;
  /**
   * Entries storage gave that no definition has checked yet, as the objects
   * it gave. An entry is unchecked while `unchecked.get(id) === progress[id]`:
   * any write by this Run makes a new object, so the entry is this tab's from
   * then on with nothing to clear. Not worked out from "has no definition",
   * because a definition is taken at the call, before the change that checks
   * its entry against it.
   */
  unchecked: ReadonlyMap<WalkthroughId, WalkthroughProgress>;
  /** What storage last said. The public status, and the `recordUnreadable` report, are worked out from it. */
  storage: StorageState;
}>;

/**
 * Storage's last word on the record. `recordUnreadable` is reported in the
 * change that turns it to `unreadable` from anything else, so it is reported
 * once until a record Waymark can read comes.
 */
export type StorageState =
  /** Storage has not answered: commands are held. */
  | Readonly<{ type: "loading" }>
  /** A record was read, or there was none, or there is no storage. */
  | Readonly<{ type: "read" }>
  /** The stored record is not one this Waymark can read. `error.stored` is the record. */
  | Readonly<{ type: "unreadable"; error: RecordUnreadableError }>
  /** Storage threw or rejected while loading. */
  | Readonly<{ type: "failed" }>;

// ─── Asked: what the app asked for that has not finished ───────────────────

export type Asked = Readonly<{
  /**
   * From `requestStart`, oldest first: walkthroughs to open once nothing is.
   * Not worked out from progress: a request is used up when it opens or is
   * found started, and `reset` must not bring it back.
   */
  waiting: readonly WalkthroughId[];
  /** The checklist whose Start opened each walkthrough still running, as the record does not say which button was pressed. */
  startedFrom: ReadonlyMap<WalkthroughId, ChecklistName>;
}>;

// ─── Live: what the page shows now ──────────────────────────────────────────

export type Live = Readonly<{
  /** What is happening on the open walkthrough's step, while one is open. */
  visit: Visit | undefined;
  /**
   * Where each collapsed walkthrough's Waymark was last seen, while none is
   * open. A beacon with no sighting, or one for another step, has not been
   * looked for yet.
   */
  beacons: ReadonlyMap<WalkthroughId, Sighting>;
}>;

/**
 * One visit to the open walkthrough's step: what the page and the user have
 * done on it since it showed. The step's Snapshot is worked out from this,
 * the walkthrough's entry and its definition. A visit counts only while its
 * walkthrough's entry is running, not collapsed and at the visit's step.
 */
export type Visit = Readonly<{
  walkthrough: WalkthroughId;
  /** A message raised on another visit finds another key and does nothing. */
  key: VisitKey;
  /** `start` has gone through, so clicks and checks count. Carried from step to step. */
  started: boolean;
  /** It opened part way through, so `start` is not announced. Carried from step to step. */
  resumed: boolean;
  /** Looked at since the Run last attached. Carried from step to step. */
  looked: boolean;
  /** The step's click or event has happened. */
  satisfied: boolean;
  /** Next is unlocked: the condition was met, or the step has none. */
  unlocked: boolean;
  /** Since when the condition has held, for a step that waits a while. */
  heldSince: number | undefined;
  /** The Waymark has been scrolled into view on this visit. */
  scrolled: boolean;
  sighting: Sighting;
}>;

export type VisitKey = symbol;

/** Where one step's Waymark was last seen. */
export type Sighting = Readonly<{
  step: number;
  waymark: Location;
  /** Since when it has not been seen, so it turns waiting, missing or lost. */
  unseenSince: number | undefined;
  /** Reused next frame while it still matches, to skip a `querySelector`. */
  element: Element | null;
}>;

// ─── A change ───────────────────────────────────────────────────────────────

export type Facts = Readonly<{ given: Given; recorded: Recorded; asked: Asked; live: Live }>;

/** The facts a view reads: what the app asked for is never drawn. */
export type Shown = Omit<Facts, "asked">;

/** One step of a change. Pure: no DOM, no storage, no app code. Hands back `facts` itself when nothing moved. */
export type Work = (facts: Facts, change: Change) => Facts;

/** What one change tells, gathered in order while it runs and announced once its facts are in. Works only add to it. */
export type Change = Readonly<{
  /** `Date.now()`, once per change. */
  now: number;
  events: RunEvent[];
  problems: WaymarkProblem[];
  /** The checklist each Task's status was changed from, for its event. */
  credits: Map<TaskId, ChecklistName>;
  /** Waymarks a rule asked to scroll into view. */
  scrolls: Element[];
  /** What the completion conditions say of `context`, asked by the shell so no work runs app code. `undefined` when one threw. */
  verdicts: (tasks: readonly DefinedTask[], context: unknown) => ReadonlyMap<TaskId, boolean> | undefined;
}>;

/**
 * A change: up to three parts, run in this order, then `settle`. Where each
 * part ends says what is saved and what is announced:
 *
 * - `storage`: what storage said. Not saved, as storage holds it.
 * - `arrival`: every unchecked entry checked against its definition, then the
 *   completion conditions asked. Saved, not announced.
 * - `commands`: what the user or the app did, in order. Saved and announced.
 *
 * A change with neither `storage` nor `arrival` announces too.
 */
export type Phases = Readonly<{
  storage?: Work;
  arrival?: true;
  commands?: readonly Work[];
  /** Save the whole record in place of the stored one: the app replaced one Waymark could not read. */
  whole?: true;
}>;

/** What the page measured of a Waymark. */
export type WaymarkRead = Readonly<{ element: Element | null; rect: Rect | null; inView: boolean }>;

/** Whether the step's condition held, when it was checked. */
export type AdvanceRead = Readonly<{ holds: boolean }>;

export type StepRead = Readonly<{
  now: number;
  waymark?: WaymarkRead | undefined;
  advance?: AdvanceRead | undefined;
}>;

/** What the page tells the open visit. Each names the visit it was raised on, but an action, which is for whatever is open. */
export type Message =
  | Readonly<{ type: "act"; action: Action }>
  | Readonly<{ type: "stepRead"; visit: VisitKey; read: StepRead }>
  /** The first look since the visit showed or the Run attached: looked, then the read, then `start`. */
  | Readonly<{ type: "look"; visit: VisitKey; read: StepRead | undefined }>
  | Readonly<{ type: "click"; visit: VisitKey; hit: ClickHit; now: number }>
  | Readonly<{ type: "event"; visit: VisitKey; now: number }>
  | Readonly<{ type: "detached" }>;
