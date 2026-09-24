import type { Run } from "../run/types";

type Subscribe = (listener: () => void) => () => void;

/** A `subscribe` that adds to this set; unsubscribing removes. */
export const listen =
  (listeners: Set<() => void>): Subscribe =>
  (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

/**
 * Subscribes to the owner and to whichever Run it holds, swapping Runs as the
 * owner changes, so the listener hears both. Unsubscribing lets go of both.
 */
export function followActive(
  subscribe: Subscribe,
  activeRun: () => Run<any> | undefined,
  listener: () => void,
): () => void {
  // Wrapped, so the same listener given twice is two subscriptions to a Run.
  const onRun = () => listener();
  let followed: { run: Run<any>; unsubscribe: () => void } | undefined;
  const follow = () => {
    const run = activeRun();
    if (followed?.run === run) return;
    followed?.unsubscribe();
    followed = run === undefined ? undefined : { run, unsubscribe: run.subscribe(onRun) };
  };
  follow();
  const unsubscribeOwner = subscribe(() => {
    follow();
    listener();
  });
  return () => {
    unsubscribeOwner();
    followed?.unsubscribe();
    followed = undefined;
  };
}
