const sameArgs = (a: readonly unknown[], b: readonly unknown[]): boolean => {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
};

/**
 * `compute`, handing back its last result while every argument is the object
 * it was last time. `compute` gets that last result too, to keep the parts
 * that did not move. Each Run makes its own, so two Runs never share one.
 */
export function memo<TArgs extends readonly unknown[], TResult>(
  compute: (args: TArgs, last: TResult | undefined) => TResult,
): (...args: TArgs) => TResult {
  let last: Readonly<{ args: TArgs; result: TResult }> | undefined;
  return (...args) => {
    if (last === undefined || !sameArgs(args, last.args)) last = { args, result: compute(args, last?.result) };
    return last.result;
  };
}
