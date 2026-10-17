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
  /** Picked up where it was left, collapsed or on an earlier page: it began there, so `start` is not sent again. */
  resumed: boolean;
  attached: boolean;
  element: Element | null;
  satisfied: boolean;
  /** The advance condition's side of the gate; `canAdvance` also opens while the Waymark is lost or missing. */
  unlocked: boolean;
  scrolled: boolean;
  heldSince: number | undefined;
  /** Since when the Step's Waymark has not been seen: while it is searched for, or found and then gone. */
  unseenSince: number | undefined;
}>;

/** The driver adds `interrupt` itself, as only it sees another walkthrough start. */
export type MachineEvent = Exclude<RunEventType, "interrupt">;

export type Outcome<TStep extends Step = Step> = Readonly<{
  state: State<TStep>;
  events: readonly MachineEvent[];
  waymarkGone?: "lost" | "missing" | undefined;
  scrollTo?: Element | undefined;
}>;

export const NO_EVENTS: readonly MachineEvent[] = [];

export const noChange = <TStep extends Step>(
  state: State<TStep>,
): Outcome<TStep> => ({
  state,
  events: NO_EVENTS,
});

export const ABSENT: Location = { status: "absent" };
export const SEARCHING: Location = { status: "searching" };
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

/** What a walkthrough's State carries from the one before it: the Run's, not its step's. */
type Carried = Pick<State, "stepGeneration" | "started" | "resumed" | "attached">;

/** Everything but the Snapshot, as a new step or a new phase begins. */
const fresh = <TStep extends Step>(
  snapshot: Snapshot<TStep>,
  previous: Carried,
  unlocked = false,
): State<TStep> => ({
  snapshot,
  stepGeneration: previous.stepGeneration + 1,
  started: previous.started,
  resumed: previous.resumed,
  attached: previous.attached,
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
  previous: Carried,
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
    collapsed: false,
    waymark,
  };
  return fresh(snapshot, previous, unlocked);
}

/**
 * A walkthrough opening at `index`, its step generation after the last one
 * the Run showed, so nothing raised on that step can act on this one.
 * `resumed` when it was already part way: it sends no `start` when drawn.
 */
export const opening = <TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  index: number,
  { stepGeneration, attached, resumed }: Readonly<{ stepGeneration: number; attached: boolean; resumed: boolean }>,
): State<TStep> => enter(walkthrough, index, { stepGeneration, attached, resumed, started: false });

export function end<TStep extends Step>(
  previous: State<TStep>,
  running: Running<TStep>,
  phase: "completed" | "exited",
): State<TStep> {
  const snapshot = { phase, stepIndex: running.stepIndex, stepCount: running.stepCount };
  return fresh(snapshot, previous);
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
