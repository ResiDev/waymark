/**
 * Waymark's vocabulary, in one place. A Tutorial is a definition, a Run is one
 * live execution of it, and a Step is one instruction that may point at a
 * Waymark — an element in the page marked `data-waymark` — and may state an
 * Advance condition.
 *
 * Everything a user of the library writes or reads is declared in this file;
 * every other module in core is machinery hidden behind `defineTutorial` and
 * `createRun`.
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

/**
 * What has to happen before a Run may leave a Step.
 *
 * - `"click"` — the user clicks the Waymark (or the halo drawn around it).
 * - `{ event }` — the Waymark fires one of these DOM events.
 * - `{ state }` — the predicate holds, checked once a frame. It receives the
 *   Waymark element, or `null` on a Step that has none.
 */
export type AdvanceCondition =
  | "click"
  | Readonly<{ event: string | readonly string[] }>
  | Readonly<{ state: (waymark: Element | null) => boolean }>;

/**
 * An Advance condition, plus what meeting it does.
 *
 * `then: "advance"` (the default) moves the Run on by itself;
 * `then: "unlock"` only opens the Advance gate, leaving the move to the user.
 * Either way the gate is shut until the condition is met — a Step that states
 * a condition cannot be skipped past.
 */
export type AdvanceSpec =
  | AdvanceCondition
  | Readonly<{
      when: AdvanceCondition;
      then?: "advance" | "unlock";
      /** Grace period between meeting the condition and acting on it. */
      delayMs?: number;
    }>;

/**
 * One instruction, as core understands it.
 *
 * Deliberately carries no content: what a Step *renders* belongs to whichever
 * adapter is driving the Run, which extends this type with its own payload
 * (see react-waymark's TutorialStep, which adds a ReactNode).
 */
export type Step = Readonly<{
  /** Matches `[data-waymark="<waymark>"]` in the page. */
  waymark?: string;
  /** A CSS selector, for elements you cannot annotate. Use instead of `waymark`. */
  selector?: string;
  advance?: AdvanceSpec;
  /** Defaults to `"once"`: scroll the Waymark into view the first time it is off-screen. */
  scroll?: "once" | "always" | "never";
}>;

/** An ordered definition, built by `defineTutorial`. Runnable more than once. */
export type Tutorial<TStep extends Step = Step> = Readonly<{
  steps: readonly TStep[];
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
  /** False while an Advance gate is shut. */
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

/** Everything a renderer needs, and nothing about how core found it out. */
export type Snapshot<TStep extends Step = Step> = Running<TStep> | Ended;

/**
 * Something the Run did. `step`/`stepIndex` name the Step the event happened
 * *on*; `snapshot` is the Run as it stands *after* it.
 */
export type RunEvent<TStep extends Step = Step> = Readonly<{
  type: "start" | Action | "finish";
  step: TStep;
  stepIndex: number;
  snapshot: Snapshot<TStep>;
}>;

/**
 * The parts of the tutorial's own UI, so that clicks on them are not mistaken
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
 * One live execution of a Tutorial.
 *
 * The Run watches the page only while someone is subscribed and the Run is
 * still going: no subscribers, or a finished Run, means no frame loop and no
 * global listeners.
 */
export type Run<TStep extends Step = Step> = Readonly<{
  act: (action: Action) => void;
  getSnapshot: () => Snapshot<TStep>;
  subscribe: (listener: () => void) => () => void;
}>;
