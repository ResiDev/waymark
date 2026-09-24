import type { Step } from "../walkthrough/types";

/**
 * One live execution of a Walkthrough. A renderer reads a Snapshot and sends
 * Actions; that is the whole of the surface. See GLOSSARY.md for the terms in
 * prose.
 */

/** A Waymark's position, in viewport coordinates. A plain copy of a DOMRect. */
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

/** Everything a Run can be asked to do. */
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
 * Where the Run believes the current Step's Waymark is.
 *
 * `absent` is a Step with no Waymark at all; the other three are the life of
 * a Waymark the Run is looking for. Once found, a Waymark that leaves the
 * page is `lost`, never `searching` again.
 */
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
  /** False while the Advance gate is shut. */
  canAdvance: boolean;
  /** A Collapsed run is hidden behind a beacon, and resumable. */
  collapsed: boolean;
  waymark: Location;
}>;

export type Ended = Readonly<{
  phase: "completed" | "exited";
  stepIndex: number;
  stepCount: number;
}>;

/**
 * Everything a renderer needs, and nothing about how core found it out.
 * A new object only when something in it changed, so it is safe to compare
 * by identity (as `useSyncExternalStore` does).
 */
export type Snapshot<TStep extends Step = Step> = Running<TStep> | Ended;

/** Everything a Run announces: opening, each Action it takes, and finishing. */
export type RunEventType = "start" | Action | "finish";

/**
 * Something the Run did. `step`/`stepIndex` name the Step the event happened
 * *on*; `snapshot` is the Run as it stands *after* it.
 */
export type RunEvent<TStep extends Step = Step> = Readonly<{
  type: RunEventType;
  step: TStep;
  stepIndex: number;
  snapshot: Snapshot<TStep>;
}>;

/**
 * The parts of the walkthrough's own UI, so that clicks on them are not mistaken
 * for the user clicking away. Elements carrying `data-waymark-ui` count too, no
 * registration needed.
 */
export type UiElements = Readonly<{
  dialog: Element | null;
  beacon: Element | null;
}>;

export type RunOptions<TStep extends Step = Step> = Readonly<{
  /** Where Waymarks are looked for. Defaults to `document`. */
  root?: Document | Element;
  /** Halo around a Waymark, in px. Clicks inside it count as Waymark clicks. */
  waymarkPadding?: number;
  /** Step to open on. Defaults to 0. */
  startAt?: number;
  ui?: () => UiElements;
  onEvent?: (event: RunEvent<TStep>) => void;
}>;

/**
 * One live execution of a Walkthrough.
 *
 * The Run watches the page only while someone is subscribed and the Run is
 * still going: no subscribers, or a finished Run, means no frame loop and no
 * global listeners.
 */
export type Run<TStep extends Step = Step> = Readonly<{
  /**
   * Completes before returning, except when called inside a subscriber or
   * onEvent handler. Those calls enqueue the action and return immediately;
   * it runs after the current change's notifications and events finish.
   */
  act: (action: Action) => void;
  getSnapshot: () => Snapshot<TStep>;
  subscribe: (listener: () => void) => () => void;
}>;
