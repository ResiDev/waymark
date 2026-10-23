import type { Stored } from "./checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot, DefinedTask, StorageStatus } from "./checklists/types";
import type { WaymarkProblem } from "./problems";
import type { ClickHit } from "./run/input";
import type { Action, Beacon, Location, OpenWalkthrough, Rect, RunEvent, RunSnapshot, WaymarkEvent } from "./run/types";
import type { Parsed, Read, RecordChanges, RecordUnreadableError, StoredRecord } from "./storage/records";
import type { Walkthrough, WalkthroughProgress } from "./walkthrough/types";

type WalkthroughId = string;
type TaskId = string;
type ChecklistName = string;

export type WalkthroughsAndChecklistsInUse = Readonly<{
  walkthroughsById: ReadonlyMap<WalkthroughId, Walkthrough>;
  checklistDefinitions: readonly ChecklistGroup[];
}>;

export type UserRecord = Readonly<{
  walkthroughProgressById: Readonly<Record<WalkthroughId, WalkthroughProgress>>;
  taskStatusById: Stored;
  /**
   * Walkthrough progress storage gave that no definition has verified yet, as
   * the objects it gave. Not worked out from "has no definition", because a
   * definition is taken at the call, before the change that verifies its
   * progress against it.
   */
  unverifiedWalkthroughProgressById: ReadonlyMap<WalkthroughId, WalkthroughProgress>;
  storageStatus: StorageState;
}>;

export type StorageState =
  | Readonly<{ type: Exclude<StorageStatus, "unreadable"> }>
  | Readonly<{ type: "unreadable"; error: RecordUnreadableError }>;

export type StartRequests = Readonly<{
  /**
   * Not worked out from progress: a request is used up when it opens or is
   * found started, and `reset` must not bring it back.
   */
  waitingToStart: readonly WalkthroughId[];
  /** Which checklist's Start opened each walkthrough still running: the record does not say which button was pressed. */
  startedFromChecklist: ReadonlyMap<WalkthroughId, ChecklistName>;
}>;

export type Live = Readonly<{
  openStep: StepState | undefined;
  beaconWaymarks: ReadonlyMap<WalkthroughId, WaymarkState>;
}>;

export type StepState = Readonly<{
  walkthrough: WalkthroughId;
  showingId: ShowingId;
  /** `resuming` opened from a running record, so its first look sends no `start`. */
  start: "pending" | "resuming" | "started";
  looked: boolean;
  gate: Gate;
  scrolled: boolean;
  waymark: WaymarkState;
}>;

/** Whether the user may go past the step. `since` is when its condition was first met; its delay counts from then. */
export type Gate =
  | Readonly<{ _tag: "locked" }>
  // A `state` check has held since then. It locks again if the check stops holding, or the Run detaches.
  | Readonly<{ _tag: "holding"; since: number }>
  // The click or event came then. It stays met.
  | Readonly<{ _tag: "met"; since: number }>
  | Readonly<{ _tag: "unlocked" }>;

export type ShowingId = symbol;

export type WaymarkState = Readonly<{
  step: number;
  location: Location;
  unseenSince: number | undefined;
  /** Reused next frame while it still matches, to skip a `querySelector`. */
  element: Element | null;
}>;

export type RunState = Readonly<{
  walkthroughsAndChecklistsInUse: WalkthroughsAndChecklistsInUse;
  checklistContext: unknown;
  userRecord: UserRecord;
  startRequests: StartRequests;
  live: Live;
}>;

export type ShownRunState = Omit<RunState, "startRequests" | "checklistContext">;

export type Work = (runState: RunState, change: Change) => RunState;

export type Change = Readonly<{
  now: number;
  events: RunEvent[];
  problems: WaymarkProblem[];
  credits: Map<TaskId, ChecklistName>;
  scrolls: Element[];
  verdicts: (tasks: readonly DefinedTask[], context: unknown) => ReadonlyMap<TaskId, boolean> | undefined;
}>;

export type Phases = Readonly<{
  storage?: Work;
  arrival?: true;
  commands?: readonly Work[];
  replace?: true;
}>;

export type WaymarkRead = Readonly<{ element: Element | null; rect: Rect | null; inView: boolean }>;

export type AdvanceRead = Readonly<{ holds: boolean }>;

export type StepRead = Readonly<{
  now: number;
  waymark?: WaymarkRead | undefined;
  advance?: AdvanceRead | undefined;
}>;

export type Message =
  | Readonly<{ type: "act"; action: Action }>
  | Readonly<{ type: "stepRead"; showingId: ShowingId; read: StepRead }>
  | Readonly<{ type: "look"; showingId: ShowingId; read: StepRead | undefined }>
  | Readonly<{ type: "click"; showingId: ShowingId; hit: ClickHit; now: number }>
  | Readonly<{ type: "event"; showingId: ShowingId; now: number }>
  | Readonly<{ type: "detached" }>;

// ─── The Run as messages in, effects out ────────────────────────────────────
//
// Everything that happens to the Run is a `Msg`. `update` in run/update.ts
// takes the `Model` and one `Msg` and returns the next `Model` and the
// `Effect`s, and decides nothing else anywhere. `run.ts` assigns the `Model`
// and performs the effects, in order.

/**
 * What the app has handed the Run. Written by the public call that hands it
 * over, not by `update`, so a second definition under one id throws at that
 * call even while the first waits in the queue. `update` only reads it.
 */
export type Given = Readonly<{
  walkthroughsAndChecklistsInUse: WalkthroughsAndChecklistsInUse;
  checklistContext: unknown;
  /** Every checklist the app has asked for, in the order asked. */
  checklistsAsked: ReadonlyMap<ChecklistDefinition<AnyTask>, ChecklistAsked>;
}>;

export type ChecklistAsked = Readonly<{
  group: ChecklistGroup;
  /** What it showed when first asked for, until a change works it out again. */
  first: ChecklistShown;
}>;

/** Everything else the Run holds. Only `update` makes one. */
export type Model = Readonly<{
  userRecord: UserRecord;
  startRequests: StartRequests;
  live: Live;
  /** Commands given while the record loads, oldest first. The change that takes the record in runs them. */
  held: readonly Command[];
  views: Views;
}>;

// ─── Views: what the Run hands out, and what it was worked out from ─────────

/**
 * A value and what it was worked out from. The same `from`, part by part,
 * gives back this same object, so React sees no change and nobody is
 * notified.
 */
export type Shown<T, TFrom extends readonly unknown[]> = Readonly<{ value: T; from: TFrom }>;

export type Candidates = readonly (readonly [Walkthrough, WalkthroughProgress])[];

export type RunViews = Readonly<{
  from: readonly [WalkthroughsAndChecklistsInUse, UserRecord, Live];
  /** The collapsed walkthroughs that may show a beacon. The page reads them to know which Waymarks to measure. */
  candidates: Shown<Candidates, readonly [UserRecord, ReadonlyMap<WalkthroughId, Walkthrough>, WalkthroughId | undefined]>;
  open: Shown<
    OpenWalkthrough | null,
    readonly [Walkthrough | undefined, WalkthroughProgress | undefined, StepState | undefined, readonly ChecklistGroup[]]
  >;
  beacons: Shown<readonly Beacon[], readonly [Candidates, Live["beaconWaymarks"]]>;
  snapshot: Shown<RunSnapshot, readonly [StorageStatus, UserRecord["walkthroughProgressById"], OpenWalkthrough | null, readonly Beacon[]]>;
}>;

export type ChecklistShown = Shown<
  ChecklistSnapshot<AnyTask>,
  readonly [UserRecord["taskStatusById"], UserRecord["walkthroughProgressById"], StorageState, WalkthroughId | undefined]
>;

export type Views = Readonly<{
  run: RunViews;
  /** Each checklist worked out since it was asked for. One not here shows its `ChecklistAsked.first`. */
  checklists: ReadonlyMap<ChecklistDefinition<AnyTask>, ChecklistShown>;
}>;

// ─── Msg: everything that happens to the Run ────────────────────────────────

/**
 * A command from the app, with the definition the call took. Held while the
 * record loads, so it acts on the user's progress rather than none.
 */
export type Command =
  | Readonly<{ _tag: "start"; walkthrough: Walkthrough; fromChecklist: ChecklistName | undefined }>
  /** The part of `requestStart` that waits for the record: a walkthrough the user already has progress in is not waiting. */
  | Readonly<{ _tag: "request"; walkthrough: Walkthrough }>
  /** `walkthrough` is `undefined` only while loading, for whichever is open once the record is in. */
  | Readonly<{ _tag: "act"; action: Action; walkthrough: Walkthrough | undefined }>
  | Readonly<{ _tag: "reset"; walkthrough: Walkthrough }>
  | Readonly<{ _tag: "markDone"; task: TaskId }>
  /** `checklist` is the one whose button it was, for the event. */
  | Readonly<{ _tag: "markTodo" | "toggle"; task: TaskId; checklist: ChecklistName }>
  /** `checklist` is `undefined` from the popover's Skip, which credits the checklist that started the walkthrough. */
  | Readonly<{ _tag: "skip"; task: TaskId; checklist: ChecklistName | undefined }>;

export type Msg =
  | Command
  | Readonly<{ _tag: "requestStart"; walkthrough: Walkthrough }>
  | Readonly<{ _tag: "withdrawRequest"; walkthrough: WalkthroughId }>
  | Readonly<{ _tag: "contextChanged" }>
  /** Definitions reached `Given`: check progress against them and ask the conditions. */
  | Readonly<{ _tag: "arrived" }>
  // From storage.
  | Readonly<{ _tag: "loaded"; read: Parsed | "failed" }>
  | Readonly<{ _tag: "heard"; read: Parsed }>
  | Readonly<{ _tag: "refused"; error: RecordUnreadableError }>
  | Readonly<{ _tag: "replaced"; read: Read | null }>
  // From the page.
  | Readonly<{ _tag: "page"; message: Message }>
  | Readonly<{ _tag: "beaconsRead"; reads: ReadonlyMap<WalkthroughId, WaymarkRead>; now: number }>
  | Readonly<{ _tag: "attached" }>
  | Readonly<{ _tag: "detached" }>;

// ─── Effect: everything the Run does to the outside ─────────────────────────

export type Effect =
  | Readonly<{ _tag: "scroll"; element: Element }>
  /** Open or close the page's listeners and frame loop to match, and queue the first look if one is due. */
  | Readonly<{ _tag: "syncPage" }>
  | Readonly<{ _tag: "notifyRun"; snapshot: RunSnapshot }>
  | Readonly<{ _tag: "notifyChecklist"; checklist: ChecklistDefinition<AnyTask>; snapshot: ChecklistSnapshot<AnyTask> }>
  | Readonly<{ _tag: "save"; changes: RecordChanges }>
  /** For `onChange`, after every save. */
  | Readonly<{ _tag: "saved"; record: StoredRecord }>
  | Readonly<{ _tag: "recordUnreadable"; error: RecordUnreadableError }>
  | Readonly<{ _tag: "problem"; problem: WaymarkProblem }>
  | Readonly<{ _tag: "event"; event: WaymarkEvent }>;

export type Inputs = Readonly<{
  now: number;
  /** Asks the Tasks' `isComplete`, which is app code. */
  verdicts: Change["verdicts"];
}>;

export type Updated = Readonly<{ model: Model; effects: readonly Effect[] }>;
