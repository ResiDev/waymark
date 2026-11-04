// `string & {}` accepts custom event names without collapsing the union to
// `string`, which would lose autocomplete for the built-in ones.
export type WaymarkEventName = keyof HTMLElementEventMap | (string & {});

type AdvanceOptions = Readonly<{
  /** `"advance"`, the default, moves on by itself; `"unlock"` leaves the move to the user. */
  then?: "advance" | "unlock";
  /** How long the condition must hold, unbroken, before it counts. */
  delayMs?: number;
}>;

type StateCondition = Readonly<{ state: (waymark: Element | null) => boolean }> & AdvanceOptions;

/**
 * The user cannot advance past the Step until it is met. `state` is checked
 * once a frame, with the Waymark element or `null`.
 */
export type AdvanceCondition =
  | "click"
  | (Readonly<{ click: true }> & AdvanceOptions)
  | (Readonly<{ event: WaymarkEventName | readonly WaymarkEventName[] }> & AdvanceOptions)
  | StateCondition;

type StepFields = Readonly<{
  /** `"once"`, the default, scrolls the Waymark into view the first time it is off-screen. */
  scroll?: "once" | "always" | "never";
  /** How long to wait for the Waymark before it counts as missing. Defaults to 3000. */
  missingAfterMs?: number;
  meta?: unknown;
}>;

/**
 * No content: what a Step shows belongs to the adapter, which adds its own
 * fields. A click or an event happens on the Waymark, so only a Step with one
 * may wait for it; a Step without one could never be passed.
 */
export type Step = StepFields &
  (
    | Readonly<{
        /** Matches `[data-waymark="<waymark>"]`. */
        waymark: string;
        selector?: never;
        advance?: AdvanceCondition;
      }>
    | Readonly<{
        waymark?: never;
        /** For elements you cannot mark with `data-waymark`. */
        selector: string;
        advance?: AdvanceCondition;
      }>
    | Readonly<{ waymark?: never; selector?: never; advance?: StateCondition }>
  );

/**
 * Mapped, not intersected like `Exactly`, so a typo is reported on its own key
 * instead of collapsing the whole object. Homomorphic, so keys TypeScript adds
 * as optional when inferring sibling literals together may stay absent.
 */
type Only<T, TShape> = { readonly [K in keyof T]: K extends keyof TShape ? T[K] : never };

type ExactAdvance<A> = A extends { click: unknown }
  ? Only<A, { click: unknown } & AdvanceOptions>
  : A extends { event: unknown }
    ? Only<A, { event: unknown } & AdvanceOptions>
    : A extends { state: unknown }
      ? Only<A, { state: unknown } & AdvanceOptions>
      : A;

/**
 * The object forms of `advance` have optional keys, so a misspelled `delayMs`
 * still fits one and would otherwise compile. `NoInfer` so the Step is
 * inferred from the plain `TStep[]` beside this, not back through the mapping.
 */
export type ExactStep<TStep extends object, TShape> = NoInfer<
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

/**
 * What a click away, Escape and being interrupted do to a walkthrough.
 * `"collapse"` hides it behind its beacon and keeps its place; `"exit"` ends
 * it, as its × does, and the exit is stored like any other.
 */
export type Dismiss = "collapse" | "exit";

export type Walkthrough<TStep extends Step = Step> = Readonly<{
  /** Its key in the stored record, so it must not change between releases. */
  id: string;
  steps: readonly TStep[];
  /** Defaults to `"collapse"`. */
  dismiss?: Dismiss;
  /** In ms, since the last change. Older stored progress part way through starts again. Defaults to a day. */
  maxAge?: number;
}>;

/** What `defineWalkthrough` takes. `TShape` lets an adapter allow its own Step fields, such as `content`. */
export type WalkthroughDefinition<TStep extends TShape, TShape extends Step = Step> = Readonly<{
  id: string;
  steps: readonly TStep[] & readonly ExactStep<TStep, TShape>[];
  dismiss?: Dismiss;
  maxAge?: number;
}>;

/**
 * How far one user is through one walkthrough. A walkthrough with none has
 * not started. Saved, so a reload puts the user back where they were.
 */
export type WalkthroughProgress = Readonly<{
  status: "running" | "finished" | "exited";
  step: number;
  stepCount: number;
  /** Hidden behind its beacon, keeping its place. */
  collapsed: boolean;
  /** Epoch ms. */
  changedAt: number;
}>;
