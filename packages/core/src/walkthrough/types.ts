/**
 * What an application writes. A Walkthrough is an ordered definition, and a
 * Step is one instruction that may point at a Waymark — an element in the page
 * marked `data-waymark` — and may state an Advance condition. See GLOSSARY.md
 * for the terms in prose.
 */

/**
 * A DOM event the Waymark may fire. The built-in names autocomplete; any other
 * string is still accepted, for custom events dispatched on the Waymark.
 * `string & {}` keeps the union from collapsing to `string`, which would lose
 * the completions.
 */
export type WaymarkEventName = keyof HTMLElementEventMap | (string & {});

/** What meeting an Advance condition does, and how long it must hold first. */
type AdvanceOptions = Readonly<{
  /**
   * `"advance"` (the default) moves the Run on by itself; `"unlock"` only
   * opens the Advance gate, leaving the move to the user.
   */
  then?: "advance" | "unlock";
  /** The condition must hold this long, unbroken, before it counts as met. */
  delayMs?: number;
}>;

/**
 * What has to happen before a Run may leave a Step. Either way it is met, the
 * Advance gate is shut until then: a Step that states a condition cannot be
 * skipped past.
 *
 * - `"click"` or `{ click: true }` — the user clicks the Waymark (or the halo
 *   drawn around it). The object form is for adding options.
 * - `{ event }` — the Waymark fires one of these DOM events.
 * - `{ state }` — the predicate holds, checked once a frame. It receives the
 *   Waymark element, or `null` on a Step that has none.
 */
export type AdvanceCondition =
  | "click"
  | (Readonly<{ click: true }> & AdvanceOptions)
  | (Readonly<{ event: WaymarkEventName | readonly WaymarkEventName[] }> & AdvanceOptions)
  | (Readonly<{ state: (waymark: Element | null) => boolean }> & AdvanceOptions);

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
  advance?: AdvanceCondition;
  /** Defaults to `"once"`: scroll the Waymark into view the first time it is off-screen. */
  scroll?: "once" | "always" | "never";
  /** The application's own data for this Step. Core keeps it and ignores it. */
  meta?: unknown;
}>;

/**
 * T with each key TShape does not name retyped as `never`. Mapped, not
 * intersected like `Exactly`, so a typo is reported on its own key rather
 * than collapsing the whole object; and homomorphic, so keys TypeScript adds
 * as optional when inferring sibling literals together may stay absent.
 */
type Only<T, TShape> = { readonly [K in keyof T]: K extends keyof TShape ? T[K] : never };

/**
 * An `advance` object held to its own form: one of `click`, `event` or
 * `state`, which cannot mix, and the options.
 */
type ExactAdvance<A> = A extends { click: unknown }
  ? Only<A, { click: unknown } & AdvanceOptions>
  : A extends { event: unknown }
    ? Only<A, { event: unknown } & AdvanceOptions>
    : A extends { state: unknown }
      ? Only<A, { state: unknown } & AdvanceOptions>
      : A;

/**
 * `Exactly`, carried into `advance`, one Step at a time. The object forms of
 * `advance` have optional keys, so a misspelled `delayMs` still fits one and
 * would otherwise compile. `NoInfer`: the Step is inferred from the plain
 * `TStep[]` beside this, never back through the mapping.
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

/** An ordered definition, built by `defineWalkthrough`. Runnable more than once. */
export type Walkthrough<TStep extends Step = Step> = Readonly<{
  steps: readonly TStep[];
}>;

