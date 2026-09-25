import type { Run, Snapshot } from "../run/types";

/** A `subscribe` that adds to this set; unsubscribing removes. */
export const listen =
  <T>(listeners: Set<(snapshot: T) => void>) =>
  (listener: (snapshot: T) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

type Following<TActive> = Readonly<{
  active: TActive | null;
  step: Snapshot<any> | null;
}>;

/**
 * Subscribes to the owner and to whichever Run it holds, swapping Runs as the
 * owner changes, so the listener hears both. It is handed the active Task and
 * its Run's step together. Unsubscribing lets go of both.
 */
export function followActive<TActive extends Readonly<{ run: Run<any> }>>(
  subscribe: (listener: () => void) => () => void,
  getActive: () => TActive | null,
  listener: (snapshot: Following<TActive>) => void,
): () => void {
  const current = (): Following<TActive> => {
    const active = getActive();
    return { active, step: active?.run.getSnapshot() ?? null };
  };
  // Wrapped, so the same listener given twice is two subscriptions to a Run.
  const onRun = () => listener(current());
  let followed: { run: Run<any>; unsubscribe: () => void } | undefined;
  const follow = () => {
    const run = getActive()?.run;
    if (followed?.run === run) return;
    followed?.unsubscribe();
    followed = run === undefined ? undefined : { run, unsubscribe: run.subscribe(onRun) };
  };
  follow();
  const unsubscribeOwner = subscribe(() => {
    follow();
    listener(current());
  });
  return () => {
    unsubscribeOwner();
    followed?.unsubscribe();
    followed = undefined;
  };
}
