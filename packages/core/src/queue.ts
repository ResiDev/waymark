import { callbackThrew } from "./problems";
import type { CallbackName, ProblemHandler } from "./problems";

/**
 * Work queued from a callback waits until the current work has finished, so
 * every callback of a change sees the state that change produced. A throwing
 * callback does not stop the others; errors are thrown once the drain is over.
 */
export type Queue = Readonly<{
  run: (...work: (() => void)[]) => void;
  /** Waymark's own work, or a call to the problem handler: what it throws is thrown, never reported. */
  invoke: (work: () => void) => void;
  /** One of the app's functions: what it throws is reported as `callbackThrew`. */
  callApp: (callback: CallbackName, work: () => void) => void;
  notify: <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => void;
  /**
   * Runs work in place, even inside a drain: Svelte's store contract wants a
   * new subscriber's first call before `subscribe` returns.
   */
  now: (work: () => void) => void;
  /** Reports what one of the app's functions threw, where the caller had to catch it itself. */
  fail: (callback: CallbackName, error: unknown) => void;
}>;

export function createQueue(failure: string, reportProblem: ProblemHandler<never>): Queue {
  const queue: (() => void)[] = [];
  let draining = false;
  let errors: unknown[] = [];

  const invoke = (work: () => void) => {
    try {
      work();
    } catch (error) {
      errors.push(error);
    }
  };

  const fail = (callback: CallbackName, error: unknown) =>
    invoke(() => reportProblem(callbackThrew(callback, error)));

  const callApp = (callback: CallbackName, work: () => void) => {
    try {
      work();
    } catch (error) {
      fail(callback, error);
    }
  };

  const notify = <T>(listeners: ReadonlySet<(snapshot: T) => void>, snapshot: T) => {
    // Copied on purpose: a listener may subscribe or unsubscribe others mid-notify.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) callApp("subscriber", () => listener(snapshot));
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

  return { run, invoke, callApp, notify, now, fail };
}
