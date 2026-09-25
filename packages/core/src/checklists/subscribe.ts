import type { Queue } from "../queue";
import type { Run, Snapshot } from "../run/types";

/**
 * A `subscribe` that adds to this set and calls the listener at once with
 * the current snapshot; unsubscribing removes.
 */
export const listen =
  <T>(queue: Queue, listeners: Set<(snapshot: T) => void>, getSnapshot: () => T) =>
  (listener: (snapshot: T) => void): (() => void) => {
    listeners.add(listener);
    try {
      queue.now(() => queue.invoke(() => listener(getSnapshot())));
    } catch (error) {
      listeners.delete(listener);
      throw error;
    }
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
  // Both stores call this, each at once on subscribing, so it passes on only
  // a change. A fresh closure, so the same listener given twice is two
  // subscriptions to a Run.
  let last: Following<TActive> | undefined;
  const deliver = () => {
    const active = getActive();
    const step = active?.run.getSnapshot() ?? null;
    if (last !== undefined && last.active === active && last.step === step) return;
    last = { active, step };
    listener(last);
  };
  let followed: { run: Run<any>; unsubscribe: () => void } | undefined;
  const follow = () => {
    const run = getActive()?.run;
    if (followed?.run === run) return;
    followed?.unsubscribe();
    followed = run === undefined ? undefined : { run, unsubscribe: run.subscribe(deliver) };
  };
  const unsubscribeOwner = subscribe(() => {
    follow();
    deliver();
  });
  return () => {
    unsubscribeOwner();
    followed?.unsubscribe();
    followed = undefined;
  };
}
