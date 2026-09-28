import {
  createChecklists as createCoreChecklists,
  defineWalkthrough as defineCoreWalkthrough,
} from "waymark";
import type {
  ChecklistSelections,
  Checklists,
  DefaultChecklists,
  ChecklistsConfig,
  ExactStep,
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
  return defineCoreWalkthrough<TStep, WalkthroughStep>(steps);
}

/**
 * Core's `createChecklists` with every Task held to `ReactTask`: a title is
 * required, and the display fields sit beside core's rather than in `meta`.
 * Steps written inline on a Task are held to `WalkthroughStep`. A Task in its
 * own file is written `{ ... } satisfies ReactTask<AppContext>`.
 */
export function createChecklists<
  TContext = {},
  const TTasks extends Readonly<Record<string, ReactTask<NoInfer<TContext>>>> = Readonly<
    Record<string, ReactTask<TContext>>
  >,
  const TSelections extends ChecklistSelections<TTasks> = DefaultChecklists<TTasks>,
>(
  config: ChecklistsConfig<TContext, TTasks, TSelections, ReactTask<TContext>, WalkthroughStep>,
): Checklists<TContext, TTasks, TSelections> {
  return createCoreChecklists<TContext, TTasks, TSelections, ReactTask<TContext>, WalkthroughStep>(
    config,
  );
}
