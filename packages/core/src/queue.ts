/**
 * Work queued from a callback waits until the current work has finished, so
 * every callback of a change sees the state that change produced. A throwing
 * callback does not stop the others; errors are thrown once the drain is over.
 */
export type Queue = Readonly<{
  run: (...work: (() => void)[]) => void;
  invoke: (callback: () => void) => void;
  notify: <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => void;
  /**
   * Runs work in place, even inside a drain: Svelte's store contract wants a
   * new subscriber's first call before `subscribe` returns.
   */
  now: (work: () => void) => void;
  fail: (error: unknown) => void;
}>;

export function createQueue(failure: string): Queue {
  const queue: (() => void)[] = [];
  let draining = false;
  let errors: unknown[] = [];

  const invoke = (callback: () => void) => {
    try {
      callback();
    } catch (error) {
      errors.push(error);
    }
  };

  const notify = <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => {
    // Copied on purpose: a listener may subscribe or unsubscribe others mid-notify.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) invoke(() => listener(snapshot));
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

  const fail = (error: unknown) => {
    errors.push(error);
  };

  return { run, invoke, notify, now, fail };
}
