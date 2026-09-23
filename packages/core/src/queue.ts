/**
 * One store's changes, obeyed one at a time.
 *
 * `run` queues work and, unless a drain is already under way, drains the
 * queue. Work queued from inside a drain (a listener or handler calling back
 * into the store) waits until the work before it has finished, so every
 * callback of a change sees the state that change produced.
 *
 * Callbacks go through `invoke` or `notify`: one that throws does not stop
 * the others, nor the rest of the queue. Its error, and any handed to `fail`,
 * is thrown once the drain is over. Between drains the queue is empty.
 */
export type Queue = Readonly<{
  run: (...work: (() => void)[]) => void;
  invoke: (callback: () => void) => void;
  notify: (listeners: ReadonlySet<() => void>) => void;
  /** Report an error with those of the next drain, ahead of them. */
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

  const notify = (listeners: ReadonlySet<() => void>) => {
    // Copied on purpose: a listener may subscribe or unsubscribe others mid-notify.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) invoke(listener);
    }
  };

  const run = (...work: (() => void)[]) => {
    queue.push(...work);
    if (draining) return;
    draining = true;

    let thrown: unknown[];
    try {
      for (let cursor = 0; cursor < queue.length; cursor++) queue[cursor]!();
    } finally {
      queue.length = 0;
      draining = false;
      thrown = errors;
      errors = [];
    }

    if (thrown.length === 1) throw thrown[0];
    if (thrown.length > 1) throw new AggregateError(thrown, failure);
  };

  return { run, invoke, notify, fail: (error) => errors.push(error) };
}
