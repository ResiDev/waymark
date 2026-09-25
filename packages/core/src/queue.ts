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
  /** Calls each listener with the store's new snapshot. */
  notify: <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => void;
  /**
   * Runs work at once: in place inside a drain, else as a drain of its own.
   * For a new subscriber's first call, which Svelte's store contract wants
   * before `subscribe` returns. Whatever the work queues still waits its turn.
   */
  now: (work: () => void) => void;
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

  const now = (work: () => void) => (draining ? work() : run(work));

  return { run, invoke, notify, now, fail: (error) => errors.push(error) };
}
