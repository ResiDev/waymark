// Sketch for packages/core/src/run/memo.ts, about 30 lines.
//
// The one cache the Run's views use. A view is a pure function of the facts;
// its memo hands back the last result while every argument is the same object
// as last time, and gives `compute` the last result so it can hand back the
// parts that did not change, or all of it. That is how a snapshot keeps its
// identity for `useSyncExternalStore`: same inputs, same object; new inputs
// that change nothing drawn, the same object too.
//
// A memo holds nothing its arguments do not, so it is a cache, not state.
// count-state.ts counts its two variables once, here, for every view.

export type Memo<TArgs extends readonly unknown[], TResult> = Readonly<{
  /** The result for these arguments. Computed only when one is not the object it was last time. */
  of: (...args: TArgs) => TResult;
  /**
   * The last result handed out, without computing. `getSnapshot` reads the
   * Run's snapshot this way, so between changes it is what `commit` last
   * announced, whatever a call has handed over since.
   */
  last: () => TResult;
}>;

/** One slot: a Run has one of each view, and asks for it once per change. */
export function memo<TArgs extends readonly unknown[], TResult>(
  compute: (args: TArgs, last: TResult | undefined) => TResult,
): Memo<TArgs, TResult> {
  throw new Error("not implemented");
}

/** Each of `next`'s fields is the same as `last`'s, so `last` can be handed back. Shallow, by identity. */
export function sameFields<T extends object>(last: T | undefined, next: T): last is T {
  throw new Error("not implemented");
}
