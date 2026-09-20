import { defineWalkthrough as defineCoreWalkthrough } from "waymark";
import type { Walkthrough } from "waymark";
import type { ReactTask, WalkthroughStep } from "./types";

export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[],
): Walkthrough<NoInfer<TStep>> {
  return defineCoreWalkthrough(steps);
}

/**
 * Types a React task declared away from `createChecklists`: a title, optional
 * description and action, and a walkthrough with React content. Curried like
 * core's `defineTask` so the step type is still inferred:
 *
 *   export type AppContext = typeof initialContext;
 *   "add-photo": defineTask<AppContext>()({ title: "Add a photo", isComplete: (c) => c.hasPhoto })
 */
export function defineTask<TContext>(): <const TTask extends ReactTask<TContext>>(
  task: TTask,
) => TTask {
  return (task) => task;
}
