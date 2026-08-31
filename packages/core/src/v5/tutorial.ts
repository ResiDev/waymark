import type { AdvanceSpec, Step, Tutorial } from "./types";

/**
 * Builds a Tutorial. The only thing between an array of Steps and a Tutorial is
 * a check that the Steps are usable, done once here rather than guessed at
 * every frame.
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

/** How to find a Step's Waymark, or `undefined` on a Step without one. */
export function selectorFor(step: Step): string | undefined {
  return step.waymark === undefined
    ? step.selector
    : `[data-waymark="${step.waymark}"]`;
}

/**
 * An Advance condition with the sugar taken off. Everything downstream reads
 * this shape, so no other module has to know that `advance: "click"` and
 * `advance: { when: "click", then: "advance" }` are the same thing.
 */
export type AdvanceRule = Readonly<{
  byClick: boolean;
  byEvents: readonly string[];
  byCheck?: (waymark: Element | null) => boolean;
  /** Meeting the condition moves the Run on, rather than only opening the gate. */
  auto: boolean;
  delayMs: number;
}>;

export function advanceRule(step: Step): AdvanceRule | undefined {
  const spec: AdvanceSpec | undefined = step.advance;
  if (spec === undefined) return undefined;

  const { when, then, delayMs } =
    typeof spec === "object" && "when" in spec
      ? spec
      : { when: spec, then: undefined, delayMs: undefined };

  return {
    byClick: when === "click",
    byEvents:
      typeof when === "object" && "event" in when ? [when.event].flat() : [],
    byCheck: typeof when === "object" && "state" in when ? when.state : undefined,
    auto: (then ?? "advance") === "advance",
    delayMs: delayMs ?? 0,
  };
}
