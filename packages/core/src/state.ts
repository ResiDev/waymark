// Every piece of state alternative 1 keeps, as types. A design sketch:
// nothing imports it yet. `pnpm typecheck` checks it against the code beside it.
//
// The rule: store a fact once, where the Run learns it, and work out
// everything else from the stored facts when it is needed. A fact is stored
// only when it is an input the app gave once, something the browser or
// storage told once, or a latch that remembers that something happened.
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
// Run hands out (snapshots, checklist
// snapshots, server snapshots, saves, checklist events, which walkthrough is
// open, which beacons show) is a pure function of these, cached by the
// identity of its inputs. A cache is not state: it never holds a fact the
// inputs do not.
//
// Outside the four: the shell's handles on the outside world (listeners,
// attachments, DOM watchers, the storage connection, the queue), and the
// commands held while the record loads.

import type { Stored } from "./checklists/record";
import type { AnyTask, Checklist, ChecklistGroup, ChecklistSnapshot, DefinedTask } from "./checklists/types";
import type { WaymarkProblem } from "./problems";
import type { ClickHit } from "./run/input";
import type { StepRead, WaymarkAria, WaymarkEvents } from "./run/rules";
import type { Action, Location, RunEvent, RunSnapshot, UiElements } from "./run/types";
import type { RecordUnreadableError } from "./storage/records";
import type { Walkthrough, WalkthroughProgress } from "./walkthrough/types";

type WalkthroughId = string;
type TaskId = string;
type ChecklistName = string;

// ─── Given: what the app handed over ────────────────────────────────────────

/**
 * Inputs the app gives once, which nothing can work out again. Written by
 * `take`, `join` and `setContext` at the call, so a clash throws where it was
 * made. No published value changes with them until the next change, as
 * snapshots are worked out only in `commit`. Never saved.
 */
export type Given = Readonly<{
  /** Each walkthrough the app has used, the first definition under each id. Code, not data. */
  walkthroughs: ReadonlyMap<WalkthroughId, Walkthrough>;
  /**
   * Each `defineChecklists` group one of whose checklists has been used, in the
   * order they came. The Tasks, the first definition of each id in that order,
   * are worked out from these.
   */
  groups: readonly ChecklistGroup[];
  /** The latest facts for completion conditions, asked again as Tasks and records arrive. */
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
  /**
   * The user's place in each walkthrough they have started. Saved. Which
   * walkthrough is open is worked out from it: the one entry that is checked,
   * running and not collapsed.
   */
  progress: Readonly<Record<WalkthroughId, WalkthroughProgress>>;
  /** Each Task off todo. Saved. */
  statuses: Stored;
  /**
   * Entries storage gave that no definition has checked yet, as the objects
   * it gave. An entry is unchecked while `unchecked.get(id) === progress[id]`:
   * any write by this Run makes a new object, so the entry is this tab's from
   * then on with nothing to clear. Not worked out from "has no definition",
   * because a definition is taken at the call, before the change that checks
   * its entry against it, and nothing could then tell the check was still due.
   */
  unchecked: ReadonlyMap<WalkthroughId, WalkthroughProgress>;
  /** What storage last said. The public status, and the `recordUnreadable` report, are worked out from it. */
  storage: StorageState;
}>;

/**
 * Storage's last word on the record. The public `StorageStatus` is its `type`,
 * with `failed` shown as `error`. `recordUnreadable` is reported in the change
 * that turns it to `unreadable` from anything else, so it is reported once
 * until a record Waymark can read comes, with no flag beside it. A save
 * storage refused because the stored record is unreadable turns it to
 * `unreadable` too: it is the same fact, told by the save.
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
   * Stored, as a request is the app's, given once and taken back by
   * `withdraw`. It cannot be worked out from progress: a request is used up
   * when it opens or is found started, and forgetting a walkthrough's progress
   * with `reset` must not bring its request back. Joined and withdrawn at the
   * call, even while loading, so a start held meanwhile finds it waiting
   * rather than open. Dropped by its own change when its walkthrough has
   * progress then; opened or dropped by `settle` once nothing is open.
   */
  waiting: readonly WalkthroughId[];
  /**
   * The checklist whose Start button opened each walkthrough still running,
   * so a Skip from its popover names that checklist. Which button the user
   * pressed is not in the record. `settle` forgets an entry once its
   * walkthrough stops running, so a later start from elsewhere credits none.
   */
  startedFrom: ReadonlyMap<WalkthroughId, ChecklistName>;
}>;

// ─── Live: what the page shows now ──────────────────────────────────────────

export type Live = Readonly<{
  /** What is happening on the open walkthrough's step, while one is open. */
  visit: Visit | undefined;
  /**
   * Where each collapsed walkthrough's Waymark was last seen, while none is
   * open. Only Waymarks looked at are here: a beacon with no entry, or one
   * for another step, is unsighted, worked out from its step. Emptied while a
   * walkthrough is open, so each beacon is looked for afresh when it shows.
   */
  beacons: ReadonlyMap<WalkthroughId, Sighting>;
}>;

/**
 * One visit to the open walkthrough's step: what the page and the user have
 * done on it since it showed. Each field is a latch or a time the page told
 * once. The step's snapshot is worked out from this, the walkthrough's
 * progress entry and its definition, so `canAdvance` cannot fall out of step
 * with `unlocked` and the Waymark.
 *
 * A visit counts only while it is to the open walkthrough at the step its
 * entry is on. Made by `open` and by a rule that moves the step; one that no
 * longer counts is dropped by `settle`, its sighting handed to the beacon if
 * the walkthrough collapsed.
 */
export type Visit = Readonly<{
  /** Whose step this is. Kept because once the walkthrough collapses it is no longer open, and its sighting goes to its beacon. */
  walkthrough: WalkthroughId;
  /**
   * This visit, and no other. A click, a Waymark event or a measurement made
   * on another visit is ignored. Replaces the step generation and the Run's
   * `lastGeneration`: a new symbol cannot repeat, so nothing carries a count
   * from one walkthrough to the next.
   */
  key: VisitKey;
  /** `start` has gone through, so clicks and checks count. Carried from step to step. */
  started: boolean;
  /** It opened part way through, so `start` is not announced. Carried from step to step. */
  resumed: boolean;
  /**
   * Looked at since the Run last attached: measured, and started if it was
   * not. While attached and not looked at, the first look is due. Replaces
   * the State's `attached` and run.ts's `looked`. Carried from step to step;
   * cleared on detach.
   */
  looked: boolean;
  /** The step's click or event has happened. */
  satisfied: boolean;
  /** Next is unlocked: the condition was met, or the step has none. */
  unlocked: boolean;
  /** Since when the condition has held, for a step that waits a while. */
  heldSince: number | undefined;
  /** The Waymark has been scrolled into view on this visit. */
  scrolled: boolean;
  /** Where the step's Waymark is. */
  sighting: Sighting;
}>;

export type VisitKey = symbol;

/** Where one step's Waymark was last seen. Today's `Sighting` in rules.ts, and the Waymark half of today's `State`. */
export type Sighting = Readonly<{
  /** The step it is for. A sighting for another step is not this step's. */
  step: number;
  waymark: Location;
  /** Since when it has not been seen, so it turns waiting, missing or lost. */
  unseenSince: number | undefined;
  /** The element last found, reused next frame if it still matches, to skip a querySelector. */
  element: Element | null;
}>;

// ─── A change ───────────────────────────────────────────────────────────────

/** The four values, as a change reads them. A work hands `given` back as it was. */
export type Facts = Readonly<{ given: Given; recorded: Recorded; asked: Asked; live: Live }>;

/** One step of a change. Pure: no DOM, no storage, no app code. */
export type Work = (facts: Facts, change: Change) => Facts;

/**
 * What one change says, gathered while it runs and announced once its facts
 * are in. Holds nothing past the change. Run events are told, not worked out
 * from a before and after: going back from step 1 to 0 is `previous` or
 * `reset`, and held commands can move a step twice in one change.
 */
export type Change = Readonly<{
  /** `Date.now()`, once per change: every entry it writes has the same `changedAt`. */
  now: number;
  event: (event: RunEvent) => void;
  problem: (problem: WaymarkProblem) => void;
  /** The checklist a Task's status was changed from, for its event. */
  credit: (task: TaskId, checklist: ChecklistName) => void;
  scrollTo: (element: Element) => void;
  /**
   * What the completion conditions of `tasks` say of `context`. Asked by the
   * shell, so the pure modules run no app code; `undefined` when one threw,
   * which is reported, and nothing is recorded.
   */
  verdicts: (tasks: readonly DefinedTask[], context: unknown) => ReadonlyMap<TaskId, boolean> | undefined;
}>;

/**
 * A change: up to three parts run in this order, Tasks finished after each,
 * then `settle` once. Where each part ends says what is saved and what is
 * announced, so no change passes flags:
 *
 * - `storage`: what storage said. Not saved, as storage holds it; not announced.
 * - `arrival`: every unchecked entry whose definition has come checked, then
 *   the completion conditions asked. Saved; no checklist events, as it must
 *   not announce what the user did before.
 * - `commands`: what the user or the app did, in order: one, or every one
 *   held while the record loaded. Saved and announced. Each checks its own
 *   walkthrough's entry first, as today: `reset` forgets an unchecked entry
 *   rather than opening it to take it back to step 1.
 */
export type Phases = Readonly<{
  storage?: Work;
  arrival?: true;
  commands?: readonly Work[];
  /** Save the whole record in place of the stored one: the app replaced one Waymark could not read. */
  whole?: true;
}>;

// ─── The shell (run.ts) ─────────────────────────────────────────────────────

/** One checklist the Run has handed out, and who listens to it. Made once per definition. */
export type Handle = Readonly<{
  /** What `run.checklist(definition)` returns, the same object each time. */
  checklist: Checklist<AnyTask>;
  /** The app's subscribers: given by the app, so stored. */
  listeners: Set<(snapshot: ChecklistSnapshot<AnyTask>) => void>;
  /** Its snapshot, worked out from the facts and cached (views.ts). A cache, not state. */
  view: Readonly<{ of: (facts: Facts) => ChecklistSnapshot<AnyTask>; last: () => ChecklistSnapshot<AnyTask> }>;
}>;

export type RunShell = {
  given: Given;
  recorded: Recorded;
  asked: Asked;
  live: Live;
  /**
   * Commands given while storage is `loading`, oldest first. The change that
   * takes the record in runs them, in order, as its `command`, so they act on
   * the user's progress and are announced as one change. Empty once storage
   * has answered.
   */
  readonly held: Work[];
  readonly listeners: Set<(snapshot: RunSnapshot) => void>;
  readonly handles: Map<object, Handle>;
  /**
   * The facts as the Run was made, from `options.initial`, before storage was
   * read. Every server snapshot, the Run's and each checklist's, is worked out
   * from these, and cached. They never change, so neither does a server snapshot.
   */
  readonly server: Facts;
};

// ─── The page (run/page.ts) ─────────────────────────────────────────────────

/** One renderer drawing the Run, from `run.attach`. The newest one's elements and padding count. */
export type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

/** A DOM hookup and the key it was opened for: the browser's handle, so stored. A new key closes it and opens another. */
export type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

export type PageState = {
  /** Given by renderers, newest last. Attached while there is one. */
  readonly attachments: Attachment[];
  /** What core listens to. Which keys are wanted is worked out from the facts after every change. */
  watching: {
    input: Watcher<true>;
    frame: Watcher<true>;
    aria: Watcher<WaymarkAria>;
    events: Watcher<WaymarkEvents>;
  };
  /**
   * The state-check errors already reported on one visit, so a check that
   * throws every frame is reported once a visit. One value, so the visit and
   * its errors cannot disagree, as today's `thrownStep` and `thrownErrors` can.
   */
  thrown: Readonly<{ visit: VisitKey; errors: ReadonlySet<string> }> | undefined;
};

/** At module level in page.ts, shared by every Run: how many are attached to each page, for the warning when two are. */
export type AttachedRuns = WeakMap<Document, number>;

/** What the page tells the open visit. Each names the visit it was raised on, but an action, which is for whatever is open. */
export type Message =
  | Readonly<{ type: "act"; action: Action }>
  | Readonly<{ type: "stepRead"; visit: VisitKey; read: StepRead }>
  /** The first look since the visit showed or the Run attached: looked, then the read, then `start`. */
  | Readonly<{ type: "look"; visit: VisitKey; read: StepRead | undefined }>
  | Readonly<{ type: "click"; visit: VisitKey; hit: ClickHit; now: number }>
  | Readonly<{ type: "event"; visit: VisitKey; now: number }>
  | Readonly<{ type: "detached" }>;

// ─── The storage connection (storage/link.ts) ───────────────────────────────

export type LinkState = {
  /** How many `run.connect()`s are open. Other tabs are heard while there is one. */
  connections: number;
  /** Storage has been asked for the record, which it is once. Not storage's status: a Run that disconnects while loading must not ask again. */
  asked: boolean;
  /** Stops hearing other tabs, while hearing. */
  stopHearing: (() => void) | undefined;
};

// ─── The queue (queue.ts, unchanged) ────────────────────────────────────────

export type QueueState = {
  readonly waiting: (() => void)[];
  draining: boolean;
  errors: unknown[];
};
