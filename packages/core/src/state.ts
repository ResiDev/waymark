import type { Stored } from "./checklists/record";
import type { ChecklistGroup, DefinedTask, StorageStatus } from "./checklists/types";
import type { WaymarkProblem } from "./problems";
import type { ClickHit } from "./run/input";
import type { Action, Location, Rect, RunEvent } from "./run/types";
import type { RecordUnreadableError } from "./storage/records";
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
  started: boolean;
  resumed: boolean;
  looked: boolean;
  satisfied: boolean;
  unlocked: boolean;
  heldSince: number | undefined;
  scrolled: boolean;
  waymark: WaymarkState;
}>;

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
