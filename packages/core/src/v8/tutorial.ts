import type { AdvanceCondition, Step, Tutorial } from "./types";

/**
 * Builds a Tutorial, and is the only place that knows how a Step is written.
 *
 * `defineTutorial` checks the Steps once, up front. The readers below are how
 * everything else looks at a Step: they take the sugar off `advance` on the
 * spot, so no other module has to know that `advance: "click"` and
 * `advance: { when: "click" }` mean the same thing, and nothing needs to be
 * precomputed or cached.
 */
export function defineTutorial<const TStep extends Step>(
  steps: readonly TStep[],
): Tutorial<TStep> {
  if (steps.length === 0) {
    throw new Error("A tutorial needs at least one step.");
  }
  steps.forEach((step, index) => {
    if (step.waymark !== undefined && step.selector !== undefined) {
      throw new Error(
        `Step ${index} sets both 'waymark' and 'selector'; a step has one waymark.`,
      );
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

/** The Advance condition, with the `{ when }` wrapper taken off. */
export const conditionOf = (step: Step): AdvanceCondition | undefined => {
  const spec = step.advance;
  return typeof spec === "object" && "when" in spec ? spec.when : spec;
};

/** The `state` predicate of a check-based condition, if the Step has one. */
export const checkOf = (
  step: Step,
): ((waymark: Element | null) => boolean) | undefined => {
  const when = conditionOf(step);
  return typeof when === "object" && "state" in when ? when.state : undefined;
};

/** The DOM events of an event-based condition. Empty for any other kind. */
export const eventsOf = (step: Step): readonly string[] => {
  const when = conditionOf(step);
  if (typeof when !== "object" || !("event" in when)) return [];
  return typeof when.event === "string" ? [when.event] : when.event;
};

/** Meeting the condition moves the Run on, rather than only opening the gate. */
export const isAuto = (step: Step): boolean => {
  const spec = step.advance;
  return !(typeof spec === "object" && "when" in spec && spec.then === "unlock");
};

export const delayOf = (step: Step): number => {
  const spec = step.advance;
  return typeof spec === "object" && "when" in spec ? (spec.delayMs ?? 0) : 0;
};
