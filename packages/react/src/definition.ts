import {
  createChecklists as createCoreChecklists,
  defineWalkthrough as defineCoreWalkthrough,
} from "waymark";
import type {
  ChecklistSelections,
  Checklists,
  ChecklistsConfig,
  Exactly,
  ExactStep,
  Step,
  Walkthrough,
} from "waymark";
import type { ReactTask, WalkthroughStep } from "./types";

/**
 * The definition functions, typed for React. They run core's unchanged; what
 * they add is the set of fields a Step or Task may carry here, so `content`
 * and `title` are known and a misspelled field does not compile.
 */

export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[] & readonly ExactStep<TStep, WalkthroughStep>[],
): Walkthrough<NoInfer<TStep>> {
  // Core checks against its own Step, which does not name React's fields.
  return defineCoreWalkthrough<TStep>(steps as readonly TStep[] & readonly ExactStep<TStep, Step>[]);
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
  task: TTask & Exactly<TTask, ReactTask<TContext>>,
) => TTask {
  return (task) => task;
}

/**
 * Core's `createChecklists` with every Task held to `ReactTask`: a title is
 * required, and the display fields sit beside core's rather than in `meta`.
 */
export const createChecklists = createCoreChecklists as <
  TContext,
  const TTasks extends Readonly<Record<string, ReactTask<NoInfer<TContext>>>>,
  const TSelections extends ChecklistSelections<TTasks>,
>(
  config: ChecklistsConfig<TContext, TTasks, TSelections, ReactTask<TContext>>,
) => Checklists<TContext, TTasks, TSelections>;
