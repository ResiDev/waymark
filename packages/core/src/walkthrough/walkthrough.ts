import type { ExactStep, Step, Walkthrough } from "./types";

/** `TShape` lets an adapter allow its own Step fields, such as `content`. */
export function defineWalkthrough<
  const TStep extends TShape,
  TShape extends Step = Step,
>(
  steps: readonly TStep[] & readonly ExactStep<TStep, TShape>[],
): Walkthrough<NoInfer<TStep>> {
  return checkedWalkthrough<TStep>(steps, "");
}

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

// Only these readers know that `advance: "click"` and `{ click: true }` are the
// same, so nothing else has to.

export const hasWaymark = (step: Step): boolean =>
  step.waymark !== undefined || step.selector !== undefined;

export const selectorOf = (step: Step): string | undefined =>
  step.waymark === undefined
    ? step.selector
    : `[data-waymark="${step.waymark}"]`;

const conditionKinds = (step: Step): readonly string[] => {
  const advance = step.advance;
  if (typeof advance !== "object") return [];
  return (["click", "event", "state"] as const).filter((kind) => kind in advance);
};

export const isClick = (step: Step): boolean => {
  const advance = step.advance;
  return advance === "click" || (typeof advance === "object" && "click" in advance);
};

export const checkOf = (
  step: Step,
): ((waymark: Element | null) => boolean) | undefined => {
  const advance = step.advance;
  return typeof advance === "object" && "state" in advance ? advance.state : undefined;
};

export const eventsOf = (step: Step): readonly string[] => {
  const advance = step.advance;
  if (typeof advance !== "object" || !("event" in advance)) return [];
  return typeof advance.event === "string" ? [advance.event] : advance.event;
};

export const isAuto = (step: Step): boolean => {
  const advance = step.advance;
  return !(typeof advance === "object" && advance.then === "unlock");
};

export const delayOf = (step: Step): number => {
  const advance = step.advance;
  return typeof advance === "object" ? (advance.delayMs ?? 0) : 0;
};
