// Every piece of state option E keeps, as types. A design sketch: nothing
// imports it yet. `pnpm typecheck` checks it against the code beside it.
//
// Five places, each written by one file:
//
//   RunState      what the Run knows: one value, replaced once per change by `commit`
//   RunInternals  run.ts: what was published, the starting record, context
//   LinkState     storage/link.ts: the connection to storage
//   PageState     run/page.ts: the DOM
//   QueueState    queue.ts, unchanged
//
// Plus the Change: what one change says, thrown away when it ends, and the
// Command: every public command as data.
//
// "Open question" marks state that might go or change. docs/design/run-architecture/
// option-e-owners-as-values/STATE.md lists them.

import type {
  AnyTask,
  Checklist,
  ChecklistDefinition,
  ChecklistSnapshot,
  DefinedTask,
} from "./checklists/types";
import type { WaymarkProblem } from "./problems";
import type { WaymarkAria, WaymarkEvents } from "./run/rules";
import type {
  Action,
  Location,
  RunEvent,
  RunSnapshot,
  UiElements,
} from "./run/types";
import type { StorageAdapter } from "./storage/adapter";
import type { StoredRecord } from "./storage/records";
import type { Walkthrough, WalkthroughProgress } from "./walkthrough/types";

// ─── RunState ───────────────────────────────────────────────────────────────
//
// The inputs: everything the snapshot, the save and the rules are drawn from.
// Immutable. Each function that changes a part returns a new object, or the
// same object when nothing changed, so `before.x === after.x` means "x did not
// change".

export type RunState = Readonly<{
  walkthroughs: Walkthroughs;
  checklists: Checklists;
  /** The walkthrough whose popover shows, if any. At most one. */
  activeStep: StepState | undefined;
  storageStatus: StorageStatus;
  /**
   * Commands given while `storageStatus` is `loading`, oldest first. The change that
   * takes the record in runs them in order, on the user's progress, then
   * empties this. Empty whenever `storageStatus` is not `loading`.
   */
  held: readonly Command[];
  /** This visit to the step's serial number. A click or measurement carrying another is ignored. */
  lastSerialNumber: number;
}>;

/**
 * Where this Run's record is. Replaces the public `StorageStatus`, which gains
 * `unreadable`, and the report-once `unreadable` flag. Not on the record: it
 * is this tab's view of the record, and `loading` and `unreadable` describe a
 * record the Run does not have.
 *
 * An unreadable record is reported when this turns to `unreadable`, by the
 * before-and-after comparison every event uses. A refused save, or another
 * unreadable record heard, finds it `unreadable` already and reports nothing;
 * a readable record turns it back to `ready`. Shown in every snapshot, so an
 * app can say the user's progress could not be read.
 */
export type StorageStatus = "loading" | "ready" | "unreadable" | "error";

// ─── Command ────────────────────────────────────────────────────────────────

/**
 * Every public command, as data. Each public method hands the Run any
 * walkthrough or checklist it names, at once, then turns its arguments into
 * one of these. While `storageStatus` is `loading` it goes on `held`; otherwise it
 * is applied in a change of its own.
 *
 * Not commands: `requestStart` (it goes on `waiting`), `setContext` (only the
 * latest counts), `connect`, `attach` and `subscribe`.
 */
export type Command =
  | Readonly<{ type: "start"; walkthrough: WalkthroughId }>
  | Readonly<{
      type: "act";
      action: Action;
      walkthrough: WalkthroughId | undefined;
    }>
  | Readonly<{ type: "reset"; walkthrough: WalkthroughId }>
  | Readonly<{
      type: "task";
      task: TaskId;
      do: "start" | "markDone" | "markTodo" | "skip" | "toggle";
      /** The checklist whose button it was, for the event. `undefined` from the popover's Skip, `run.skipTask`. */
      checklist: ChecklistName | undefined;
    }>;

/** The one function every command, held or not, goes through. */
export type ApplyCommand = (state: RunState, command: Command) => RunState;

// ─── walkthroughs (written only by walkthroughs.ts) ─────────────────────────
//
type WalkthroughId = string;

export type Walkthroughs = Readonly<{
  /**
   * Every walkthrough the app has handed the Run, by id. They arrive as code
   * uses them: `run.start(tour)`, a `<Walkthrough>` mounting, a checklist with
   * a Task that has one. Never saved: they are code, not data.
   */
  definitions: ReadonlyMap<WalkthroughId, Walkthrough>;

  /**
   * Where each on-screen walkthrough's Waymark was last seen: the active one,
   * and every collapsed one showing a beacon. The step it is for is the
   * walkthrough's `progress[id].step`. Never saved.
   */
  waymarks: ReadonlyMap<WalkthroughId, LastWaymarkSighting>;

  /** The user's place in each walkthrough, by id. This is what is saved. */
  progress: Readonly<Record<WalkthroughId, WalkthroughProgress>>;

  /**
   * From `requestStart`: walkthroughs asking to open once `storageStatus` is no
   * longer `loading` and nothing is open, oldest first. Withdrawing one takes
   * it off. Not saved.
   */
  waiting: readonly WalkthroughId[];
}>;

export type LastWaymarkSighting = Readonly<{
  /** Found at a rect, still being searched for, missing or lost. */
  waymark: Location;
  /** Since when it has not been seen, so it turns missing or lost after a while. */
  unseenSince: number | undefined;
  /** The element last found, reused next frame if it still matches, to skip a querySelector. */
  element: Element | null;
}>;

/**
 * The walkthrough whose popover shows, and what is happening on its step
 * right now. Today this is `machine`: `{ walkthrough, state, looked }`, with
 * these fields inside `state`. Flattened here, the walkthrough replaced by
 * its id, `looked` gone (see `started`), and its Waymark in
 * `walkthroughs.waymarks`, beside the beacons'.
 *
 * Between changes it is always running and not collapsed: the end of every
 * change lets go of one that ended or collapsed.
 */
export type StepState = Readonly<{
  /**
   * Its `start` has gone through, so clicks and checks count. Not started
   * while attached means it has just appeared, and is due its first look: the
   * Run measures its Waymark and starts it at once, not a frame later. This
   * replaces `looked`, and fixes the bug where a walkthrough started and
   * advanced in one go never starts.
   */
  started: boolean;

  /** Picked up where the user left it, so `start` is not announced again. */
  resumed: boolean;
  /** The step's advance condition has been met. */
  satisfied: boolean;
  /** Next is unlocked: the condition was met, or the step has none. */
  unlocked: boolean;
  /** When a "must hold for a while" condition started holding. */
  heldSince: number | undefined;
  /** The Waymark has been scrolled into view on this visit. */
  scrolled: boolean;
}>;

// ─── checklists (written only by checklists.ts) ─────────────────────────────
type ChecklistName = string;
type TaskId = string;

export type Checklists = Readonly<{
  /** Each Task's status, by id. Only Tasks off todo are here. Saved. */
  statuses: Readonly<Record<string, "done" | "skipped" | "reopened">>;

  /**
   * Every Task of the checklists the app has used, the first definition of
   * each id, in the order they arrived. The order is the order checklist
   * events go in. Merges today's `tasks` array and `taskById` map.
   */
  tasks: ReadonlyMap<TaskId, DefinedTask>;

  /**
   * Which checklist's Start button opened each walkthrough still running, by
   * walkthrough id.
   *
   * A Task can be in more than one checklist. When the user presses Skip in
   * the walkthrough's popover, the `taskSkipped` event names a checklist, and
   * this says which: the one they started it from. Forgotten when the
   * walkthrough stops running.
   *
   * Open question: it is about a walkthrough, so it could live in
   * `walkthroughs`, or on `progress` entries if it should survive a reload.
   */
  startedFrom: ReadonlyMap<WalkthroughId, ChecklistName>;
}>;

// ─── RunInternals (run.ts) ──────────────────────────────────────────────────
//
// Not inputs: outputs, or what outputs are worked out from. Mutable, but only
// run.ts writes them.

/**
 * What the Run, or one checklist, last handed out, and who is listening.
 *
 * `snapshot` is kept so a reader gets the same object while nothing changed,
 * which React's `useSyncExternalStore` and Solid's signals rely on, and so
 * listeners are called only when it is a new one.
 *
 * `serverSnapshot` is what a server render shows. Storage is read only by
 * `connect`, which a server never calls, so it is worked out from
 * `RunInternals.initial` and the definitions, on the first
 * `getServerSnapshot`, and kept. Its inputs never change, so it cannot go
 * stale. A checklist that hydrates late, inside a `<Suspense>`, after
 * `connect` has read storage, still matches the server's HTML.
 */
export type Published<T> = {
  snapshot: T;
  serverSnapshot: T | undefined;
  readonly listeners: Set<(snapshot: T) => void>;
};

export type RunInternals<TContext> = {
  /** The one variable holding RunState. `commit` alone assigns it. */
  state: RunState;
  /** `options.initial`: the record a server render starts from, and so every server snapshot. */
  readonly initial: StoredRecord | undefined;
  /** The Run's own snapshot: `getSnapshot` and `subscribe`. */
  readonly run: Published<RunSnapshot>;
  /** Each checklist the app asked for, with the object `run.checklist(definition)` hands back, made once. */
  readonly checklists: Map<
    ChecklistDefinition<AnyTask>,
    Published<ChecklistSnapshot<AnyTask>> & {
      readonly checklist: Checklist<AnyTask>;
    }
  >;
  /**
   * The app's facts, for Task completion conditions only. Kept because Tasks
   * and the record arrive later, and both are checked against the latest one.
   * Typed by the Run's `TContext`, inferred from `createRun({ context })`, so
   * `setContext` and each checklist's conditions are checked against it.
   */
  context: TContext | undefined;
};

// ─── LinkState (storage/link.ts) ────────────────────────────────────────────
//
// Internal: no app sees the link. The app gives `createRun({ storage })`, which
// becomes the adapter, and its renderer calls `run.connect()` (WaymarkRoot does,
// on mount). The link sits between them: it knows when to ask the adapter for
// the record, and when to listen for other tabs. Only here; nothing else
// counts connections.

export type LinkState = {
  /**
   * How many `run.connect()`s are open. Other tabs are heard while there is
   * one. A count, not a boolean: two WaymarkRoots can share one Run, and
   * StrictMode mounts, unmounts and mounts again.
   */
  connections: number;
  /** The record is asked for on the first connect, never on a server render. */
  phase: "unasked" | "asking" | "loaded";
  /** Stops listening for other tabs, while listening. */
  stopHearing: (() => void) | undefined;
};

export type Link = Readonly<{ connect: () => () => void }>;
export type CreateStorageLink = (
  adapter: StorageAdapter,
  on: Readonly<{
    record: (read: unknown) => void;
    heard: (value: unknown) => void;
  }>,
) => Link;

// ─── PageState (run/page.ts) ────────────────────────────────────────────────

/**
 * One renderer drawing the Run. React's RunView calls
 * `run.attach(ui, { waymarkPadding })` on mount.
 *
 * Attaching does not make anything render: React renders from `subscribe`
 * and `getSnapshot`. It tells core that something is drawing the Run, and
 * how to find what it drew:
 * - `ui().dialog`: the popover element, so a click inside it is not a click away
 * - `padding`: the room around the Waymark that still counts as clicking it
 * While nothing is attached, core does not watch the page, and time unseen
 * does not count towards a Waymark going missing.
 */
export type Attachment = Readonly<{ ui: () => UiElements; padding: number }>;

/** A DOM hookup and the key it was opened for. A new key closes it and opens another. */
export type Watcher<K> = Readonly<{ key: K; close: () => void }> | undefined;

export type PageState = {
  /** Renderers drawing the Run, newest last. The newest one's elements count; the one before takes over when it unmounts. */
  attachments: Attachment[];
  /** What core listens to on the page. `sync()` brings it in line with RunState after every change. */
  watching: {
    /** Clicks and keys on the window, while a step is shown. */
    input: Watcher<true>;
    /** The next animation frame, while a Waymark or a beacon is followed. */
    frame: Watcher<true>;
    /** `aria-haspopup` and `aria-expanded` on the Waymark element, put back as they were when closed. */
    aria: Watcher<WaymarkAria>;
    /** Listeners on the Waymark element, for steps that advance on an event. */
    events: Watcher<WaymarkEvents>;
  };
  /**
   * Errors thrown by the app's state checks, by message, with the step each
   * was reported on.
   *
   * Not every error: only the ones a step's `check` throws. A check is the
   * app's function, such as `(input) => input.value !== ""`, called every
   * frame. One with a bug would throw 60 times a second. Each distinct error
   * is reported once a step, as a `callbackThrew` problem, to the app's
   * problem handlers.
   */
  thrown: Map<string, number>;
};

/** At module level in page.ts, shared by every Run: how many are attached to each page, for the development warning when two are. */
export type AttachedRuns = WeakMap<Document, number>;

// ─── QueueState (queue.ts, unchanged) ───────────────────────────────────────

export type QueueState = {
  /** Work given while a change is being announced, run once it is done. */
  readonly waiting: (() => void)[];
  draining: boolean;
  /** What the app's callbacks threw during a drain, thrown once it is over. */
  errors: unknown[];
};

// ─── Change (one per change) ────────────────────────────────────────────────

/** Gathered while one change runs, announced once its state is in. */
export type Gathered = Readonly<{
  events: readonly RunEvent[];
  problems: readonly WaymarkProblem[];
  /** The checklist each Task's status was changed from, for its event. */
  credits: ReadonlyMap<string, string>;
  /** Elements to scroll into view. */
  scrolls: readonly Element[];
}>;
