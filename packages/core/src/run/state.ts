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
  /** Picked up where an earlier page left it: it began there, so `start` is not sent again. */
  resumed: boolean;
  mounted: boolean;
  element: Element | null;
  satisfied: boolean;
  /** The advance condition's side of the gate; `canAdvance` also opens while the Waymark is lost or missing. */
  unlocked: boolean;
  scrolled: boolean;
  heldSince: number | undefined;
  /** Since when the Step's Waymark has not been seen: while it is searched for, or found and then gone. */
  unseenSince: number | undefined;
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
const SEARCHING: Location = { status: "searching" };
export const WAITING: Location = { status: "waiting" };
export const LOST: Location = { status: "lost" };
export const MISSING: Location = { status: "missing" };

/** The step has a Waymark, but the user is shown the step without it: `lost` or `missing`. */
export const isGone = (
  waymark: Location,
): waymark is Extract<Location, { status: "lost" | "missing" }> =>
  waymark.status === "lost" || waymark.status === "missing";

/** The user is shown the step without its Waymark, so the gate must not hold them there. */
const gateOpen = (unlocked: boolean, waymark: Location): boolean =>
  unlocked || isGone(waymark);

export function stepAt<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  index: number,
): TStep {
  const step = walkthrough.steps[index];
  if (step === undefined) throw new RangeError(`No step at index ${index}.`);
  return step;
}

/** Everything but the Snapshot, as a new step or a new phase begins. */
const fresh = <TStep extends Step>(
  snapshot: Snapshot<TStep>,
  previous: State<TStep> | undefined,
  unlocked = false,
): State<TStep> => ({
  snapshot,
  stepGeneration: previous ? previous.stepGeneration + 1 : 0,
  started: previous?.started ?? false,
  resumed: previous?.resumed ?? false,
  mounted: previous?.mounted ?? false,
  element: null,
  satisfied: false,
  unlocked,
  scrolled: false,
  heldSince: undefined,
  unseenSince: undefined,
});

export function enter<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  index: number,
  previous?: State<TStep>,
  collapsed = false,
): State<TStep> {
  const step = stepAt(walkthrough, index);
  const unlocked = step.advance === undefined;
  const waymark = hasWaymark(step) ? SEARCHING : ABSENT;
  const snapshot: Running<TStep> = {
    phase: "running",
    step,
    stepIndex: index,
    stepCount: walkthrough.steps.length,
    canAdvance: gateOpen(unlocked, waymark),
    collapsed,
    waymark,
  };
  return fresh(snapshot, previous, unlocked);
}

export function end<TStep extends Step>(
  previous: State<TStep>,
  running: Running<TStep>,
  phase: "completed" | "exited",
): State<TStep> {
  const snapshot = { phase, stepIndex: running.stepIndex, stepCount: running.stepCount };
  return fresh(snapshot, previous);
}

export const loading = <TStep extends Step>(walkthrough: Walkthrough<TStep>): State<TStep> =>
  fresh({ phase: "loading", stepCount: walkthrough.steps.length }, undefined);

/** Where a Run begins: as asked, or as storage left it. */
export type Start =
  | Readonly<{ phase: "running"; step: number; collapsed: boolean; resumed: boolean }>
  | Readonly<{ phase: "completed" | "exited" }>;

export function begin<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  start: Start,
  previous?: State<TStep>,
): State<TStep> {
  if (start.phase === "running") {
    return { ...enter(walkthrough, start.step, previous, start.collapsed), resumed: start.resumed };
  }
  // Storage keeps no step for an ended Run; these are the ones it would have ended on.
  const stepCount = walkthrough.steps.length;
  const stepIndex = start.phase === "completed" ? stepCount - 1 : 0;
  return fresh({ phase: start.phase, stepIndex, stepCount }, previous);
}

/**
 * `running` is `state.snapshot`, passed in because the caller has already narrowed it.
 * The gate's fields go through `gate`, so `canAdvance` cannot fall out of step.
 */
export function show<TStep extends Step>(
  state: State<TStep>,
  running: Running<TStep>,
  change: Partial<Omit<Running<TStep>, "canAdvance" | "waymark">>,
): State<TStep> {
  return { ...state, snapshot: { ...running, ...change } };
}

/** Changes the advance condition's side of the gate or the Waymark, and works out `canAdvance` from both. */
export function gate<TStep extends Step>(
  state: State<TStep>,
  running: Running<TStep>,
  {
    unlocked = state.unlocked,
    waymark = running.waymark,
  }: Readonly<{ unlocked?: boolean; waymark?: Location }>,
): State<TStep> {
  return {
    ...state,
    snapshot: { ...running, waymark, canAdvance: gateOpen(unlocked, waymark) },
    unlocked,
  };
}
