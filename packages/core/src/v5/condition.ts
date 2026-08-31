import type { AdvanceRule } from "./tutorial";

/**
 * Tracks one Step's Advance condition, for as long as the Run is on that Step.
 *
 * It listens to the Waymark for the Step's events, runs the Step's state check
 * once a frame, applies the delay, and tells the Run once — not once a frame —
 * when the condition is met. It never decides what meeting the condition
 * *does*; that is the Run's business.
 */
export type ConditionTracker = Readonly<{
  /** Called once a frame, with whatever the Locator currently holds. */
  observe: (element: Element | null, now: number) => void;
  /** The condition was met from outside: the user clicked the Waymark. */
  satisfy: (now?: number) => void;
  /** Stops listening to the Waymark. */
  release: () => void;
}>;

type ConditionState = {
  /**
   * The frame time at which the condition counts as met — first met plus the
   * Step's delay. Cleared if a state check stops holding before then.
   */
  dueAt: number | undefined;
  /** A latch, so the Run hears that the condition was met once. */
  reported: boolean;
};

export function trackCondition(
  rule: AdvanceRule,
  onMet: () => void,
): ConditionTracker {
  const state: ConditionState = { dueAt: undefined, reported: false };
  /** The Waymark we are listening to; aborting removes every listener. */
  let listening: { element: Element; abort: AbortController } | null = null;

  const reportIfDue = (now: number) => {
    if (state.reported) return;
    if (state.dueAt === undefined || now < state.dueAt) return;
    state.reported = true;
    onMet();
  };

  /**
   * Starts the clock on a met condition, and acts on it at once when the Step
   * asked for no delay — a click should not wait for the next frame to be felt.
   */
  const satisfy = (now = performance.now()) => {
    state.dueAt ??= now + rule.delayMs;
    reportIfDue(now);
  };

  const listenTo = (element: Element | null) => {
    if ((listening?.element ?? null) === element) return;
    listening?.abort.abort();
    listening = null;
    if (!element || rule.byEvents.length === 0) return;
    const abort = new AbortController();
    for (const name of rule.byEvents) {
      element.addEventListener(name, () => satisfy(), { signal: abort.signal });
    }
    listening = { element, abort };
  };

  const observe = (element: Element | null, now: number) => {
    listenTo(element);
    if (rule.byCheck) {
      if (rule.byCheck(element)) satisfy(now);
      else state.dueAt = undefined; // must still hold when it comes due
    }
    reportIfDue(now);
  };

  return { observe, satisfy, release: () => listenTo(null) };
}
