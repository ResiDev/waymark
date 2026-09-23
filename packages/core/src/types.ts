/**
 * Waymark's public vocabulary, in one place. See GLOSSARY.md for the terms in
 * prose; this file is their shape.
 *
 * A Walkthrough is a definition, a Run is one live execution of it, and a Step is
 * one instruction that may point at a Waymark — an element in the page marked
 * `data-waymark` — and may state an Advance condition. A renderer reads a
 * Snapshot and sends Actions; that is the whole of the surface.
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
      /** The condition must hold this long, unbroken, before it counts as met. */
      delayMs?: number;
    }>;

/**
 * One instruction, as core understands it.
 *
 * Deliberately carries no content: what a Step *renders* belongs to whichever
 * adapter is driving the Run, which extends this type with its own named
 * fields. Any other key is an error, so a misspelled field does not compile.
 */
export type Step = Readonly<{
  /** Matches `[data-waymark="<waymark>"]` in the page. */
  waymark?: string;
  /** A CSS selector, for elements you cannot annotate. Use instead of `waymark`. */
  selector?: string;
  advance?: AdvanceSpec;
  /** Defaults to `"once"`: scroll the Waymark into view the first time it is off-screen. */
  scroll?: "once" | "always" | "never";
  /** The application's own data for this Step. Core keeps it and ignores it. */
  meta?: unknown;
}>;

/**
 * T, with every key that TShape does not name turned into an error. Inferred
 * literals skip TypeScript's own excess property check, so the definition
 * functions apply this to reject a misspelled field.
 */
export type Exactly<T, TShape> = T extends unknown
  ? T & { readonly [K in Exclude<keyof T, keyof TShape>]: never }
  : never;

/**
 * T with each key TShape does not name retyped as `never`. Mapped, not
 * intersected like `Exactly`, so a typo is reported on its own key rather
 * than collapsing the whole object; and homomorphic, so keys TypeScript adds
 * as optional when inferring sibling literals together may stay absent.
 */
type Only<T, TShape> = { readonly [K in keyof T]: K extends keyof TShape ? T[K] : never };

/** A condition object held to its own form, so `event` and `state` cannot mix. */
type ExactCondition<C> = C extends { event: unknown }
  ? Only<C, { event: unknown }>
  : C extends { state: unknown }
    ? Only<C, { state: unknown }>
    : C;

/** An `advance` value held to its own form, down through `when`. */
type ExactAdvance<A> = A extends { when: unknown }
  ? {
      readonly [K in keyof A]: K extends "when"
        ? ExactCondition<A[K]>
        : K extends keyof Extract<AdvanceSpec, { when: unknown }>
          ? A[K]
          : never;
    }
  : ExactCondition<A>;

/**
 * `Exactly`, carried into `advance`, one Step at a time. The object forms of
 * `advance` have optional keys, so a misspelled `delayMs` still fits one and
 * would otherwise compile. `NoInfer`: the Step is inferred from the plain
 * `TStep[]` beside this, never back through the mapping.
 */
export type ExactStep<TStep extends Step, TShape> = NoInfer<
  TStep extends unknown
    ? {
        readonly [K in keyof TStep]: K extends "advance"
          ? ExactAdvance<TStep[K]>
          : K extends keyof TShape
            ? TStep[K]
            : never;
      }
    : never
>;

/** An ordered definition, built by `defineWalkthrough`. Runnable more than once. */
export type Walkthrough<TStep extends Step = Step> = Readonly<{
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
