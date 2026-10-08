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
  UnstoredWalkthrough,
  UnstoredWalkthroughOptions,
  Walkthrough,
  WalkthroughOptions,
} from "waymark-core";
import type { ReactTask, WalkthroughStep } from "./types";

export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[] & readonly ExactStep<TStep, WalkthroughStep>[],
): UnstoredWalkthrough<NoInfer<TStep>>;
export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[] & readonly ExactStep<TStep, WalkthroughStep>[],
  options: UnstoredWalkthroughOptions<NoInfer<TStep>>,
): Walkthrough<NoInfer<TStep>> & Readonly<{ storage?: never }>;
export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[] & readonly ExactStep<TStep, WalkthroughStep>[],
  options: WalkthroughOptions<NoInfer<TStep>>,
): Walkthrough<NoInfer<TStep>>;
export function defineWalkthrough<const TStep extends WalkthroughStep>(
  steps: readonly TStep[] & readonly ExactStep<TStep, WalkthroughStep>[],
  options?: WalkthroughOptions<NoInfer<TStep>> | UnstoredWalkthroughOptions<NoInfer<TStep>>,
): Walkthrough<NoInfer<TStep>> {
  if (options?.storage !== undefined) {
    return defineCoreWalkthrough<TStep, WalkthroughStep>(steps, { ...options, storage: options.storage });
  }
  const onProblem = options?.onProblem;
  return defineCoreWalkthrough<TStep, WalkthroughStep>(steps, onProblem ? { onProblem } : {});
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
