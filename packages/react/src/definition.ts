import { defineWalkthrough as defineCoreWalkthrough } from "waymark";
import type { Walkthrough } from "waymark";
import type { WalkthroughStep } from "./types";

export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[],
): Walkthrough<TStep> {
  return defineCoreWalkthrough(steps);
}
