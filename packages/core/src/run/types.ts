import type { Checklist, ChecklistDefinition, ChecklistsEvent, StorageStatus } from "../checklists/types";
import type { ProblemHandlers } from "../problems";
import type { StorageAdapter } from "../storage/adapter";
import type { StoredRecord } from "../storage/records";
import type { Step, Walkthrough, WalkthroughProgress } from "../walkthrough/types";

/** In viewport coordinates. */
export type Rect = Readonly<{
  x: number;
  y: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}>;

export const actions = [
  "advance",
  "previous",
  "collapse",
  "resume",
  "reset",
  "exit",
] as const;

export type Action = (typeof actions)[number];

/**
 * `absent`: the Step has no Waymark. `searching` becomes `waiting` after a
 * moment, when the Step shows without its Waymark while the page catches up,
 * then `missing` once it has lasted too long, and stays so until the Waymark
 * is found. Once found, a Waymark that leaves the page stays `found` for a
 * moment, in case it comes straight back, then is `lost`, not `searching`.
 */
export type Location =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "searching" }>
  | Readonly<{ status: "waiting" }>
  | Readonly<{ status: "found"; rect: Rect }>
  | Readonly<{ status: "lost" }>
  | Readonly<{ status: "missing" }>;

export type Running<TStep extends Step = Step> = Readonly<{
  phase: "running";
  step: TStep;
  stepIndex: number;
  stepCount: number;
  /** Also true while the Waymark is `lost` or `missing`, so a user is never stuck behind a condition that cannot be met. */
  canAdvance: boolean;
  collapsed: boolean;
  waymark: Location;
}>;

export type Ended = Readonly<{
  phase: "completed" | "exited";
  stepIndex: number;
  stepCount: number;
}>;

/** One walkthrough at one moment. A new object only when something in it changed. */
export type Snapshot<TStep extends Step = Step> = Running<TStep> | Ended;

type StepIn<TWalkthrough extends Walkthrough> = TWalkthrough["steps"][number];

/** The walkthrough whose popover shows. */
export type OpenWalkthrough<TWalkthrough extends Walkthrough = Walkthrough> = Readonly<{
  walkthrough: TWalkthrough;
  snapshot: Running<StepIn<TWalkthrough>>;
  /** The id of the task it guides, once a checklist holding that task has reached the Run. */
  task: string | null;
}>;

/** A collapsed walkthrough, drawn as a beacon the user clicks to go back to it. */
export type Beacon<TWalkthrough extends Walkthrough = Walkthrough> = Readonly<{
  walkthrough: TWalkthrough;
  step: StepIn<TWalkthrough>;
  stepIndex: number;
  /**
   * `found`, to sit on the Waymark. Only the walkthrough collapsed most
   * recently shows without one, at the bottom of the screen: its step has no
   * Waymark, or it is `lost` or `missing`.
   */
  waymark: Location;
}>;

/** A new object only when something in it changed. */
export type RunSnapshot<TWalkthrough extends Walkthrough = Walkthrough> = Readonly<{
  /** `loading` until the record is in; `error` when it could not be read, and every walkthrough starts afresh. */
  storageStatus: StorageStatus;
  /**
   * Every walkthrough the user has started, by id. Progress restored for a
   * walkthrough whose definition has not reached the Run waits here as data.
   */
  progress: Readonly<Record<string, WalkthroughProgress>>;
  open: OpenWalkthrough<TWalkthrough> | null;
  /** None while a walkthrough is open. */
  beacons: readonly Beacon<TWalkthrough>[];
}>;

/** A Waymark that becomes lost or missing is a problem, not an event: see `problemHandlers`. */
export type RunEventType = "start" | Action | "finish" | "interrupt";

/**
 * `walkthrough` is its id. `step` and `stepIndex` are the Step the event
 * happened on; `snapshot` is the walkthrough after it.
 */
export type RunEvent<TStep extends Step = Step> =
  | Readonly<{
      type: Exclude<RunEventType, "interrupt">;
      walkthrough: string;
      step: TStep;
      stepIndex: number;
      snapshot: Snapshot<TStep>;
    }>
  | Readonly<{
      /** In place of `collapse` or `exit`, as its `dismiss` says, when another walkthrough is started over it. */
      type: "interrupt";
      walkthrough: string;
      step: TStep;
      stepIndex: number;
      snapshot: Snapshot<TStep>;
      /** The id of the walkthrough started over it. */
      interruptedBy: string;
    }>;

/** A walkthrough's events and a checklist's, in the order they happened. */
export type WaymarkEvent<TStep extends Step = Step> = RunEvent<TStep> | ChecklistsEvent;

/**
 * The renderer's elements. Clicks on them, or inside anything marked
 * `data-waymark-ui`, are not the user clicking away, and keys pressed in
 * other Waymark UI are left to it.
 */
export type UiElements = Readonly<{
  dialog: Element | null;
}>;

export type AttachOptions = Readonly<{
  /** In px. The room the shade leaves around the Waymark; clicks this close to it count as clicks on it. Defaults to 0. */
  waymarkPadding?: number;
}>;

export type RunOptions<TWalkthrough extends Walkthrough = Walkthrough> = Readonly<{
  /** Where Waymarks are looked for. Defaults to `document`. */
  root?: Document | Element;
  /**
   * A localStorage key, or an adapter. Without one, progress lasts as long as
   * the Run. Until a Promise from the adapter's `load` settles, the Run is
   * `loading` and holds its commands.
   */
  storage?: string | StorageAdapter;
  /** A record already in hand, such as one fetched for a server render. The Run starts from it and does not load, though it still saves. */
  initial?: StoredRecord;
  /** Hears the record each time it changes, for an app that keeps it itself. */
  onChange?: (stored: StoredRecord) => void;
  /**
   * Handlers for the problems the Run meets. A problem without one is logged
   * if it is storage's, thrown if it is an error from the app's own
   * functions, and otherwise passes quietly.
   */
  problemHandlers?: ProblemHandlers<StepIn<TWalkthrough>>;
  /** What checklists' completion conditions read. Change it with `setContext`. */
  context?: unknown;
  onEvent?: (event: WaymarkEvent<StepIn<TWalkthrough>>) => void;
}>;

/**
 * One user's walkthroughs: how far they are through each, and the one that is
 * open. Watches the page only while attached and a walkthrough is open.
 */
export type Run<TWalkthrough extends Walkthrough = Walkthrough> = Readonly<{
  /**
   * Shows a walkthrough the user asked for, now. An open walkthrough is set
   * aside as its `dismiss` says. Part way through, this one opens where it was;
   * finished or exited, it starts again at step 1.
   */
  start: (walkthrough: TWalkthrough) => void;
  /**
   * Shows a walkthrough the app chose, not the user. It waits until no
   * walkthrough is open, so it never interrupts one the user is in, and does
   * nothing if the user has already finished or exited it. Returns a function
   * that withdraws the request while it waits.
   */
  requestStart: (walkthrough: TWalkthrough) => () => void;
  /**
   * Acts on the open walkthrough, or on `walkthrough` when given. One that is
   * not open takes only `resume`, which opens it as `start` does, `reset` and
   * `exit`. Called from a listener or an `onEvent` handler, it runs after the
   * current change's notifications and events, not before returning.
   */
  act: (action: Action, walkthrough?: TWalkthrough) => void;
  /**
   * Starts a walkthrough again from its first step, whatever its progress:
   * an open one goes back to step 1, and any other is forgotten, as if the
   * user had never started it.
   */
  reset: (walkthrough: TWalkthrough) => void;
  getSnapshot: () => RunSnapshot<TWalkthrough>;
  /**
   * The snapshot from before storage was read, for a server render and the
   * hydration after it, which cannot see the browser's storage.
   */
  getServerSnapshot: () => RunSnapshot<TWalkthrough>;
  /** Calls the listener at once, as Svelte's store contract requires, then on each change. Changes nothing. */
  subscribe: (listener: (snapshot: RunSnapshot<TWalkthrough>) => void) => () => void;
  /**
   * Says a renderer is drawing the Run, which switches on its page listeners:
   * keys, clicks, the frame loop and the Waymark's aria. `ui` is read as each
   * key and click arrives. The newest attachment's elements and padding count.
   * Returns a function that detaches.
   */
  attach: (ui: () => UiElements, options?: AttachOptions) => () => void;
  /** New facts for checklists' completion conditions, which are checked again. */
  setContext: (context: unknown) => void;
  /** A checklist's live state and commands. The same object each time for one definition. */
  checklist: <TTask extends { readonly id: string }>(definition: ChecklistDefinition<TTask>) => Checklist<TTask>;
  /** Skips a todo task and exits its walkthrough, as its popover's Skip does. See `OpenWalkthrough["task"]`. */
  skipTask: (id: string) => void;
}>;
