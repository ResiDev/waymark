import type { ExactStep, Step, Walkthrough } from "./types";

/**
 * Builds a Walkthrough, and is the only place that knows how a Step is written.
 *
 * `defineWalkthrough` checks the Steps once, up front. The readers below are how
 * everything else looks at a Step: they take the sugar off `advance` on the
 * spot, so no other module has to know that `advance: "click"` and
 * `advance: { click: true }` mean the same thing, and nothing needs to be
 * precomputed or cached.
 */
export function defineWalkthrough<const TStep extends Step>(
  steps: readonly TStep[] & readonly ExactStep<TStep, Step>[],
): Walkthrough<NoInfer<TStep>> {
  return checkedWalkthrough<TStep>(steps, "");
}

/**
 * `defineWalkthrough` without the typing, for Steps written somewhere else,
 * such as inline on a Task. `where` prefixes every error, to say which.
 */
export function checkedWalkthrough<TStep extends Step>(
  steps: readonly TStep[],
  where: string,
): Walkthrough<TStep> {
  if (steps.length === 0) {
    throw new Error(`${where}A walkthrough needs at least one step.`);
  }
  steps.forEach((step, index) => {
    if (step.waymark !== undefined && step.selector !== undefined) {
      throw new Error(
        `${where}Step ${index} sets both 'waymark' and 'selector'; a step has one waymark.`,
      );
    }
    const kinds = conditionKinds(step);
    if (kinds.length > 1) {
      throw new Error(
        `${where}Step ${index} advances on ${kinds.join(" and ")}; a step has one advance condition.`,
      );
    }
    if (typeof step.advance === "object" && kinds.length === 0) {
      throw new Error(
        `${where}Step ${index} has advance options but no click, event or state; it could never advance.`,
      );
    }
    if (kinds[0] === "event" && eventsOf(step).length === 0) {
      throw new Error(`${where}Step ${index} advances on an event but names no events; it could never advance.`);
    }
  });
  return { steps };
}

// ---- reading a Step ---------------------------------------------------------

export const hasWaymark = (step: Step): boolean =>
  step.waymark !== undefined || step.selector !== undefined;

/** How to find the Step's Waymark. Only meaningful when `hasWaymark`. */
export const selectorOf = (step: Step): string =>
  step.waymark === undefined
    ? step.selector!
    : `[data-waymark="${step.waymark}"]`;

/** Which of `click`, `event` and `state` the Step's `advance` object names. */
const conditionKinds = (step: Step): readonly string[] => {
  const advance = step.advance;
  if (typeof advance !== "object") return [];
  return (["click", "event", "state"] as const).filter((kind) => kind in advance);
};

/** The condition is a click on the Waymark, written either way. */
export const isClick = (step: Step): boolean => {
  const advance = step.advance;
  return advance === "click" || (typeof advance === "object" && "click" in advance);
};

/** The `state` predicate of a check-based condition, if the Step has one. */
export const checkOf = (
  step: Step,
): ((waymark: Element | null) => boolean) | undefined => {
  const advance = step.advance;
  return typeof advance === "object" && "state" in advance ? advance.state : undefined;
};

/** The DOM events of an event-based condition. Empty for any other kind. */
export const eventsOf = (step: Step): readonly string[] => {
  const advance = step.advance;
  if (typeof advance !== "object" || !("event" in advance)) return [];
  return typeof advance.event === "string" ? [advance.event] : advance.event;
};

/** Meeting the condition moves the Run on, rather than only opening the gate. */
export const isAuto = (step: Step): boolean => {
  const advance = step.advance;
  return !(typeof advance === "object" && advance.then === "unlock");
};

export const delayOf = (step: Step): number => {
  const advance = step.advance;
  return typeof advance === "object" ? (advance.delayMs ?? 0) : 0;
};
