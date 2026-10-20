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

export type Given = Readonly<{
  walkthroughs: ReadonlyMap<WalkthroughId, Walkthrough>;
  groups: readonly ChecklistGroup[];
  context: unknown;
}>;

export type Recorded = Readonly<{
  progress: Readonly<Record<WalkthroughId, WalkthroughProgress>>;
  statuses: Stored;
  /**
   * Entries storage gave that no definition has checked yet, as the objects
   * it gave. Not worked out from "has no definition", because a definition
   * is taken at the call, before the change that checks its entry against it.
   */
  unchecked: ReadonlyMap<WalkthroughId, WalkthroughProgress>;
  storage: StorageState;
}>;

export type StorageState =
  | Readonly<{ type: Exclude<StorageStatus, "unreadable"> }>
  | Readonly<{ type: "unreadable"; error: RecordUnreadableError }>;

export type Asked = Readonly<{
  /**
   * Not worked out from progress: a request is used up when it opens or is
   * found started, and `reset` must not bring it back.
   */
  waiting: readonly WalkthroughId[];
  /** Which checklist's Start opened each walkthrough still running: the record does not say which button was pressed. */
  startedFrom: ReadonlyMap<WalkthroughId, ChecklistName>;
}>;

export type Live = Readonly<{
  visit: Visit | undefined;
  beacons: ReadonlyMap<WalkthroughId, Sighting>;
}>;

export type Visit = Readonly<{
  walkthrough: WalkthroughId;
  key: VisitKey;
  started: boolean;
  resumed: boolean;
  looked: boolean;
  satisfied: boolean;
  unlocked: boolean;
  heldSince: number | undefined;
  scrolled: boolean;
  sighting: Sighting;
}>;

export type VisitKey = symbol;

export type Sighting = Readonly<{
  step: number;
  waymark: Location;
  unseenSince: number | undefined;
  /** Reused next frame while it still matches, to skip a `querySelector`. */
  element: Element | null;
}>;

export type Facts = Readonly<{ given: Given; recorded: Recorded; asked: Asked; live: Live }>;

export type Shown = Omit<Facts, "asked">;

export type Work = (facts: Facts, change: Change) => Facts;

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
  | Readonly<{ type: "stepRead"; visit: VisitKey; read: StepRead }>
  | Readonly<{ type: "look"; visit: VisitKey; read: StepRead | undefined }>
  | Readonly<{ type: "click"; visit: VisitKey; hit: ClickHit; now: number }>
  | Readonly<{ type: "event"; visit: VisitKey; now: number }>
  | Readonly<{ type: "detached" }>;
