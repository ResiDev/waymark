import {
  createChecklists as createCoreChecklists,
  defineWalkthrough as defineCoreWalkthrough,
  everyProblem as everyCoreProblem,
} from "waymark-core";
import type {
  ChecklistController,
  ChecklistSelections,
  DefaultChecklists,
  ChecklistsConfig,
  ExactStep,
  UnstoredWalkthrough,
  UnstoredWalkthroughOptions,
  Walkthrough,
  WalkthroughOptions,
} from "waymark-core";
import type { ProblemHandlers, ReactTask, WalkthroughStep, WaymarkProblem } from "./types";

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
  const problemHandlers = options?.problemHandlers;
  return problemHandlers
    ? defineCoreWalkthrough<TStep, WalkthroughStep>(steps, { problemHandlers })
    : defineCoreWalkthrough<TStep, WalkthroughStep>(steps);
}

export function createChecklists<
  TContext = {},
  const TTasks extends Readonly<Record<string, ReactTask<NoInfer<TContext>>>> = Readonly<
    Record<string, ReactTask<TContext>>
  >,
  const TSelections extends ChecklistSelections<TTasks> = DefaultChecklists<TTasks>,
>(
  config: ChecklistsConfig<TContext, TTasks, TSelections, ReactTask<TContext>, WalkthroughStep>,
): ChecklistController<TContext, TTasks, TSelections> {
  return createCoreChecklists<TContext, TTasks, TSelections, ReactTask<TContext>, WalkthroughStep>(
    config,
  );
}

/** Core's, with its steps React's unless given, so an untyped handler's problems carry React's. */
export const everyProblem = <TStep extends WalkthroughStep = WalkthroughStep>(
  handle: (problem: WaymarkProblem<TStep>) => void,
): Required<ProblemHandlers<NoInfer<TStep>>> => everyCoreProblem(handle);
