import type { StorageAdapter } from "../storage/adapter";
import type { StoredWalkthrough } from "../storage/records";

// `string & {}` accepts custom event names without collapsing the union to
// `string`, which would lose autocomplete for the built-in ones.
export type WaymarkEventName = keyof HTMLElementEventMap | (string & {});

type AdvanceOptions = Readonly<{
  /** `"advance"`, the default, moves on by itself; `"unlock"` leaves the move to the user. */
  then?: "advance" | "unlock";
  /** How long the condition must hold, unbroken, before it counts. */
  delayMs?: number;
}>;

/**
 * The user cannot advance past the Step until it is met. `state` is checked
 * once a frame, with the Waymark element or `null`.
 */
export type AdvanceCondition =
  | "click"
  | (Readonly<{ click: true }> & AdvanceOptions)
  | (Readonly<{ event: WaymarkEventName | readonly WaymarkEventName[] }> & AdvanceOptions)
  | (Readonly<{ state: (waymark: Element | null) => boolean }> & AdvanceOptions);

/** No content: what a Step shows belongs to the adapter, which adds its own fields. */
export type Step = Readonly<{
  /** Matches `[data-waymark="<waymark>"]`. */
  waymark?: string;
  /** For elements you cannot mark with `data-waymark`. */
  selector?: string;
  advance?: AdvanceCondition;
  /** `"once"`, the default, scrolls the Waymark into view the first time it is off-screen. */
  scroll?: "once" | "always" | "never";
  /** How long to wait for the Waymark before it counts as missing. Defaults to 3000. */
  missingAfterMs?: number;
  meta?: unknown;
}>;

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

/** Where a standalone walkthrough keeps its place: a localStorage key, or an adapter. */
export type WalkthroughStore = string | StorageAdapter<StoredWalkthrough>;

export type WalkthroughOptions = Readonly<{
  /**
   * Saved as the step changes, the Run collapses or resumes, and as it ends; a
   * finished walkthrough stays finished until `reset`. A function is called
   * as each Run starts, and on a `reset` with none on screen, so the key can
   * name who is signed in; a Run keeps the key it started with. Until a
   * Promise from the adapter's `load` settles, the Run is `loading` and holds
   * its actions.
   */
  storage: WalkthroughStore | (() => WalkthroughStore);
  /** In ms, since the last change. An older running walkthrough starts again. Defaults to a day. */
  maxAge?: number;
  /** Every storage failure, from a Run or from `reset`. Without one, they are logged. */
  onStorageError?: (error: unknown) => void;
}>;

export type Walkthrough<TStep extends Step = Step> = Readonly<{
  steps: readonly TStep[];
  storage?: WalkthroughOptions["storage"];
  maxAge?: number;
  onStorageError?: WalkthroughOptions["onStorageError"];
  /**
   * Starts it again from its first step, finished or not: a Run on screen
   * starts again now, and with none on screen its stored place, if it has
   * one, is cleared.
   */
  reset: () => void;
}>;

/** A checklist's Task keeps its place in the owner's storage, so its walkthrough has none of its own. */
export type UnstoredWalkthrough<TStep extends Step = Step> = Walkthrough<TStep> &
  Readonly<{ storage?: never }>;

