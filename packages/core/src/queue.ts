import type { CallbackName } from "./problems";

/**
 * Work queued from a callback waits until the current work has finished, so
 * every callback of a change sees the state that change produced. A throwing
 * callback does not stop the others; errors are thrown once the drain is over.
 */
export type Queue = Readonly<{
  run: (...work: (() => void)[]) => void;
  /** Unnamed work is Waymark's own, or the problem handler: what it throws is thrown, never passed back. */
  invoke: (work: () => void, callback?: CallbackName) => void;
  notify: <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => void;
  /**
   * Runs work in place, even inside a drain: Svelte's store contract wants a
   * new subscriber's first call before `subscribe` returns.
   */
  now: (work: () => void) => void;
  fail: (error: unknown, callback: CallbackName) => void;
}>;

export function createQueue(
  failure: string,
  onThrow?: (error: unknown, callback: CallbackName) => void,
): Queue {
  const queue: (() => void)[] = [];
  let draining = false;
  let errors: unknown[] = [];

  const fail = (error: unknown, callback?: CallbackName) => {
    if (callback === undefined || onThrow === undefined) {
      errors.push(error);
      return;
    }
    try {
      onThrow(error, callback);
    } catch (thrown) {
      errors.push(thrown);
    }
  };

  const invoke = (work: () => void, callback?: CallbackName) => {
    try {
      work();
    } catch (error) {
      fail(error, callback);
    }
  };

  const notify = <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => {
    // Copied on purpose: a listener may subscribe or unsubscribe others mid-notify.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) invoke(() => listener(snapshot), "subscriber");
    }
  };

  const run = (...work: (() => void)[]) => {
    queue.push(...work);
    if (draining) return;
    draining = true;

    let thrown: unknown[];
    try {
      // An array's iterator also reaches work pushed while it runs.
      for (const next of queue) next();
    } finally {
      queue.length = 0;
      draining = false;
      thrown = errors;
      errors = [];
    }

    if (thrown.length === 1) throw thrown[0];
    if (thrown.length > 1) throw new AggregateError(thrown, failure);
  };

  const now = (work: () => void) => (draining ? work() : run(work));

  return { run, invoke, notify, now, fail };
}
