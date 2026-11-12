import {
  defineChecklists as defineCoreChecklists,
  defineWalkthrough as defineCoreWalkthrough,
  everyProblem as everyCoreProblem,
} from "waymark-core";
import type {
  ChecklistSelections,
  ChecklistsConfig,
  ChecklistsDefinition,
  DefaultChecklists,
} from "waymark-core";
import type {
  ProblemHandlers,
  ReactTask,
  Walkthrough,
  WalkthroughDefinition,
  WalkthroughStep,
  WaymarkProblem,
} from "./types";

/** Core's, for steps with React content, which may also say how to draw this walkthrough. */
export function defineWalkthrough<const TStep extends WalkthroughStep>(
  definition: WalkthroughDefinition<TStep>,
): Walkthrough<NoInfer<TStep>> {
  const { renderPopover, renderBeacon, ...rest } = definition;
  return {
    ...defineCoreWalkthrough<TStep, WalkthroughStep>(rest),
    ...(renderPopover === undefined ? {} : { renderPopover }),
    ...(renderBeacon === undefined ? {} : { renderBeacon }),
  };
}

export function defineChecklists<
  const TTasks extends Readonly<Record<string, ReactTask>>,
  const TSelections extends ChecklistSelections<TTasks> = DefaultChecklists<TTasks>,
>(
  config: ChecklistsConfig<TTasks, TSelections, ReactTask, WalkthroughStep>,
): ChecklistsDefinition<TTasks, TSelections> {
  return defineCoreChecklists<TTasks, TSelections, ReactTask, WalkthroughStep>(config);
}

/** Core's, with its steps React's unless given, so an untyped handler's problems carry React's. */
export const everyProblem = <TStep extends WalkthroughStep = WalkthroughStep>(
  handle: (problem: WaymarkProblem<TStep>) => void,
): Required<ProblemHandlers<NoInfer<TStep>>> => everyCoreProblem(handle);
