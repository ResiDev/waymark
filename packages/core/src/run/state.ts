import { hasWaymark } from "../walkthrough/walkthrough";
import type { Location, RunEventType, Running, Snapshot } from "./types";
import type { Step, Walkthrough } from "../walkthrough/types";

/**
 * The Snapshot is stored, not derived from the rest, so a rule that changes
 * nothing visible leaves it the same object. The driver then needs one check
 * after any rule to know whether to notify.
 */
export type State<TStep extends Step = Step> = Readonly<{
  snapshot: Snapshot<TStep>;
  stepGeneration: number;
  started: boolean;
  mounted: boolean;
  element: Element | null;
  satisfied: boolean;
  scrolled: boolean;
  heldSince: number | undefined;
}>;

export type Outcome<TStep extends Step = Step> = Readonly<{
  state: State<TStep>;
  events: readonly RunEventType[];
  scrollTo?: Element | undefined;
}>;

export const NO_EVENTS: readonly RunEventType[] = [];

export const noChange = <TStep extends Step>(
  state: State<TStep>,
): Outcome<TStep> => ({
  state,
  events: NO_EVENTS,
});

export const ABSENT: Location = { status: "absent" };
export const SEARCHING: Location = { status: "searching" };
export const LOST: Location = { status: "lost" };

export function stepAt<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  index: number,
): TStep {
  const step = walkthrough.steps[index];
  if (step === undefined) throw new RangeError(`No step at index ${index}.`);
  return step;
}

export function enter<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  index: number,
  previous?: State<TStep>,
): State<TStep> {
  const step = stepAt(walkthrough, index);
  return {
    snapshot: {
      phase: "running",
      step,
      stepIndex: index,
      stepCount: walkthrough.steps.length,
      canAdvance: step.advance === undefined,
      collapsed: false,
      waymark: hasWaymark(step) ? SEARCHING : ABSENT,
    },
    stepGeneration: previous ? previous.stepGeneration + 1 : 0,
    started: previous?.started ?? false,
    mounted: previous?.mounted ?? false,
    element: null,
    satisfied: false,
    scrolled: false,
    heldSince: undefined,
  };
}

export function end<TStep extends Step>(
  previous: State<TStep>,
  phase: "completed" | "exited",
): State<TStep> {
  return {
    snapshot: {
      phase,
      stepIndex: previous.snapshot.stepIndex,
      stepCount: previous.snapshot.stepCount,
    },
    stepGeneration: previous.stepGeneration + 1,
    started: previous.started,
    mounted: previous.mounted,
    element: null,
    satisfied: false,
    scrolled: false,
    heldSince: undefined,
  };
}

/** `running` is `state.snapshot`, passed in because the caller has already narrowed it. */
export function show<TStep extends Step>(
  state: State<TStep>,
  running: Running<TStep>,
  change: Partial<Running<TStep>>,
): State<TStep> {
  return { ...state, snapshot: { ...running, ...change } };
}
