// A sketch of a simpler Run state, beside today's packages/core/src/state.ts.
// Types only. Everything not here (Gate, WaymarkState, the public Run,
// RunSnapshot, ChecklistSnapshot, Effect, Phases, Change) stays as it is.

import type { Stored } from "../../../../packages/core/src/checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot, DefinedTask } from "../../../../packages/core/src/checklists/types";
import type { ClickHit } from "../../../../packages/core/src/run/input";
import type { Action, RunSnapshot } from "../../../../packages/core/src/run/types";
import type { Gate, ShowingId, StepRead, StorageState, WaymarkRead, WaymarkState } from "../../../../packages/core/src/state";
import type { Parsed, Read, RecordUnreadableError } from "../../../../packages/core/src/storage/records";
import type { Walkthrough, WalkthroughProgress } from "../../../../packages/core/src/walkthrough/types";

type WalkthroughId = string;
type TaskId = string;
type ChecklistName = string;

// ─── 1. One State, made only by `update` ────────────────────────────────────
//
// Replaces Given, Model, RunState, ShownRunState and Live. Definitions enter
// through a Msg, so `update` sees a definition in the same change that checks
// its stored progress. That is what lets `unverifiedWalkthroughProgressById`
// go: progress with no definition here is waiting, worked out, not stored.

export type State = Readonly<{
  defined: Defined;
  context: unknown;
  record: UserRecord;
  requests: Requests;
  /** The open walkthrough's step. Counts only while its progress is running, not collapsed, at `step`. */
  visit: Visit | undefined;
  /** The open walkthrough's Waymark and each beacon's, by walkthrough. One stays only while its progress is at its `step`. */
  waymarks: ReadonlyMap<WalkthroughId, WaymarkState>;
  /** Commands given while the record loads, oldest first. */
  held: readonly Command[];
  views: Views;
}>;

/**
 * What the app has handed over, as of this change. The shell keeps its own
 * id → definition map only to throw at the call on a second definition under
 * one id; `update` never reads it.
 */
export type Defined = Readonly<{
  walkthroughs: ReadonlyMap<WalkthroughId, Walkthrough>;
  /** Every joined group's Tasks, each id once, so `tasksOf` stops deduping on every call. */
  tasks: ReadonlyMap<TaskId, DefinedTask>;
  /** For `OpenWalkthrough.task` and a checklist row, without walking every Task. */
  taskOfWalkthrough: ReadonlyMap<WalkthroughId, TaskId>;
  groups: readonly ChecklistGroup[];
}>;

/** No `unverifiedWalkthroughProgressById`: an entry whose id is not in `Defined.walkthroughs` is waiting for its definition. */
export type UserRecord = Readonly<{
  progress: Readonly<Record<WalkthroughId, WalkthroughProgress>>;
  statuses: Stored;
  storage: StorageState;
}>;

export type Requests = Readonly<{
  /** Filled only by a `requestStart` command, so never while loading. */
  waiting: readonly WalkthroughId[];
  startedFrom: ReadonlyMap<WalkthroughId, ChecklistName>;
}>;

// ─── 3. The open step, without its Waymark ──────────────────────────────────
//
// Today's StepState less `waymark`, which moves to `State.waymarks`. The
// open walkthrough's Waymark is then already where its beacon's goes when it
// collapses, so nothing is handed over.

export type Visit = Readonly<{
  walkthrough: WalkthroughId;
  step: number;
  showingId: ShowingId;
  look: Look;
  gate: Gate;
  scrolled: boolean;
}>;

// ─── 4. `start` and `looked` as one union ───────────────────────────────────
//
// Today two fields make six pairs, of which four happen: `looked` is never
// true before `start` is "started".
//
//   pending,  false  → { _tag: "due", announce: true }
//   resuming, false  → { _tag: "due", announce: false }
//   started,  true   → { _tag: "looked" }
//   started,  false  → { _tag: "again" }

export type Look =
  /** Opened, not looked at yet. The first look sends `start` if `announce`. Its gate waits for that look. */
  | Readonly<{ _tag: "due"; announce: boolean }>
  | Readonly<{ _tag: "looked" }>
  /** Looked at, then detached. The next look sends nothing. */
  | Readonly<{ _tag: "again" }>;

// ─── 2. Views as plain values ───────────────────────────────────────────────
//
// No `Shown<T, From>`, no `from` tuples, no `candidates` view, no
// `ChecklistAsked.first`. After a change that moved `defined`, `record`,
// `visit` or `waymarks`, every view is worked out again and each keeps last
// change's object when equal to it, as `sameRunning` and `sameSnapshot`
// already decide. A change that moved none of them keeps `views` whole.
//
// A checklist asked for but not yet joined has no group in `Defined`; its
// handle works its snapshot out from the State it last saw, kept while the
// State is the same object.

export type Views = Readonly<{
  run: RunSnapshot;
  /** Every checklist of every joined group. */
  checklists: ReadonlyMap<ChecklistDefinition<AnyTask>, ChecklistSnapshot<AnyTask>>;
}>;

// ─── 5. One Msg union ───────────────────────────────────────────────────────
//
// The page's Message folds in. A key's action is the `act` command with no
// walkthrough. `requestStart` is one held command, not a wait at once plus a
// held `request`, and withdrawing is held behind it, so order alone keeps
// them right while loading.

export type Command =
  | Readonly<{ _tag: "start"; walkthrough: Walkthrough; fromChecklist: ChecklistName | undefined }>
  | Readonly<{ _tag: "requestStart"; walkthrough: Walkthrough }>
  | Readonly<{ _tag: "withdrawRequest"; walkthrough: WalkthroughId }>
  /** `walkthrough` absent: whichever is open when it runs. `reset` is an action here, so there is no `reset` command. */
  | Readonly<{ _tag: "act"; action: Action; walkthrough: Walkthrough | undefined }>
  | Readonly<{ _tag: "markDone"; task: TaskId }>
  | Readonly<{ _tag: "markTodo" | "toggle"; task: TaskId; checklist: ChecklistName }>
  | Readonly<{ _tag: "skip"; task: TaskId; checklist: ChecklistName | undefined }>;

export type Msg =
  | Command
  // From the app. Not held: they change what is known, not the user's progress.
  | Readonly<{ _tag: "join"; group: ChecklistGroup }>
  | Readonly<{ _tag: "context"; context: unknown }>
  // From storage.
  | Readonly<{ _tag: "loaded"; read: Parsed | "failed" }>
  | Readonly<{ _tag: "heard"; read: Parsed }>
  | Readonly<{ _tag: "refused"; error: RecordUnreadableError }>
  | Readonly<{ _tag: "replaced"; read: Read | null }>
  // From the page.
  | Readonly<{ _tag: "attached" }>
  | Readonly<{ _tag: "detached" }>
  | Readonly<{ _tag: "look"; showingId: ShowingId; read: StepRead | undefined }>
  | Readonly<{ _tag: "stepRead"; showingId: ShowingId; read: StepRead }>
  | Readonly<{ _tag: "click"; showingId: ShowingId; hit: ClickHit; now: number }>
  | Readonly<{ _tag: "waymarkEvent"; showingId: ShowingId; now: number }>
  | Readonly<{ _tag: "beaconsRead"; reads: ReadonlyMap<WalkthroughId, WaymarkRead>; now: number }>;
