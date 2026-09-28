import type { Step } from "../walkthrough/types";

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

/** `absent`: the Step has no Waymark. Once found, a Waymark that leaves the page is `lost`, not `searching`. */
export type Location =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "searching" }>
  | Readonly<{ status: "found"; rect: Rect }>
  | Readonly<{ status: "lost" }>;

export type Running<TStep extends Step = Step> = Readonly<{
  phase: "running";
  step: TStep;
  stepIndex: number;
  stepCount: number;
  canAdvance: boolean;
  collapsed: boolean;
  waymark: Location;
}>;

export type Ended = Readonly<{
  phase: "completed" | "exited";
  stepIndex: number;
  stepCount: number;
}>;

/** A new object only when something in it changed. */
export type Snapshot<TStep extends Step = Step> = Running<TStep> | Ended;

export type RunEventType = "start" | Action | "finish";

/** `step` and `stepIndex` are the Step the event happened on; `snapshot` is the Run after it. */
export type RunEvent<TStep extends Step = Step> = Readonly<{
  type: RunEventType;
  step: TStep;
  stepIndex: number;
  snapshot: Snapshot<TStep>;
}>;

/**
 * Clicks on these, or inside anything marked `data-waymark-ui`, are not taken
 * as the user clicking away.
 */
export type UiElements = Readonly<{
  dialog: Element | null;
  beacon: Element | null;
}>;

export type RunOptions<TStep extends Step = Step> = Readonly<{
  root?: Document | Element;
  /** In px. Clicks this close to the Waymark count as clicks on it. */
  waymarkPadding?: number;
  startAt?: number;
  ui?: () => UiElements;
  onEvent?: (event: RunEvent<TStep>) => void;
}>;

/** Watches the page only while it has a subscriber and has not ended. */
export type Run<TStep extends Step = Step> = Readonly<{
  /**
   * Called from a subscriber or `onEvent` handler, it runs after the current
   * change's notifications and events, not before returning.
   */
  act: (action: Action) => void;
  getSnapshot: () => Snapshot<TStep>;
  /** Calls the listener at once, as Svelte's store contract requires, then on each change. */
  subscribe: (listener: (snapshot: Snapshot<TStep>) => void) => () => void;
}>;
