import { defineTutorial as defineCoreTutorial } from "waymark";
import type { Tutorial } from "waymark";
import type { TutorialStep } from "./types";

export function defineTutorial<const TStep extends TutorialStep>(
  steps: readonly TStep[],
): Tutorial<TStep> {
  return defineCoreTutorial(steps);
}
