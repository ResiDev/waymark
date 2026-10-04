import {
  createChecklists as createCoreChecklists,
  defineWalkthrough as defineCoreWalkthrough,
} from "waymark-core";
import type {
  ChecklistSelections,
  Checklists,
  DefaultChecklists,
  ChecklistsConfig,
  ExactStep,
  Walkthrough,
} from "waymark-core";
import type { ReactTask, WalkthroughStep } from "./types";

export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[] & readonly ExactStep<TStep, WalkthroughStep>[],
): Walkthrough<NoInfer<TStep>> {
  return defineCoreWalkthrough<TStep, WalkthroughStep>(steps);
}

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
