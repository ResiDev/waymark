import { hasWaymark } from "./tutorial";
import type {
  Location,
  RunEventType,
  Running,
  Snapshot,
  Step,
  Tutorial,
} from "./types";

/**
 * The whole of what a Run knows.
 *
 * It is the Snapshot a renderer sees, plus Scratch about the current Step that
 * no renderer sees. The Snapshot is held, not derived: a rule that changes
 * something visible makes a new Snapshot, and one that only touches Scratch
 * leaves the old one in place. So the driver has one question to ask after
 * any rule — "is the Snapshot the same object?" — and that answers both
 * "should I notify?" and "does the renderer need a new read?".
 *
 * Only `enter` and `end` build a State from nothing; every rule copies one
 * and changes a field. That is what keeps Scratch from outliving its Step.
 */
export type State<TStep extends Step = Step> = Readonly<{
  snapshot: Snapshot<TStep>;

  // ---- Scratch: about the current Step; reset by entering one -------------

  /** The Waymark element. Kept so the next frame does not search, and so the driver can attach to it. */
  element: Element | null;
  /** The user has clicked the Waymark, or it has fired one of the Step's events. For good: the condition holds from then on. */
  satisfied: boolean;
  /** A `scroll: "once"` Step has had its one scroll. */
  scrolled: boolean;
  /** When the Advance condition started holding, for as long as it still does. */
  heldSince: number | undefined;
}>;

/** What one rule hands back. The only thing the pure half ever produces. */
export type Outcome<TStep extends Step = Step> = Readonly<{
  /** The same State by identity means nothing happened. */
  state: State<TStep>;
  /** What to announce, in order. Each is stamped with the Step it happened on. */
  events: readonly RunEventType[];
  /** Bring this element into view. Fire and forget. */
  scrollTo?: Element;
}>;

/** Shared by every Outcome with nothing to say, so quiet frames allocate less. */
export const NO_EVENTS: readonly RunEventType[] = [];

/** An Outcome with nothing to announce. Given the State that came in, it means "refused". */
export const quietly = <TStep extends Step>(
  state: State<TStep>,
): Outcome<TStep> => ({
  state,
  events: NO_EVENTS,
});

/** The Locations that carry no rect, shared so that comparing them is cheap. */
export const ABSENT: Location = { status: "absent" };
export const SEARCHING: Location = { status: "searching" };
export const LOST: Location = { status: "lost" };

/** Entering a Step *is* this object: a fresh State, so no Scratch survives. */
export function enter<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  index: number,
): State<TStep> {
  const step = tutorial.steps[index];
  return {
    snapshot: {
      phase: "running",
      step,
      stepIndex: index,
      stepCount: tutorial.steps.length,
      canAdvance: step.advance === undefined,
      collapsed: false,
      waymark: hasWaymark(step) ? SEARCHING : ABSENT,
    },
    element: null,
    satisfied: false,
    scrolled: false,
    heldSince: undefined,
  };
}

/** A Run that is over. No Step is current, so it holds no Scratch at all. */
export function end<TStep extends Step>(
  tutorial: Tutorial<TStep>,
  phase: "completed" | "exited",
  index: number,
): State<TStep> {
  return {
    snapshot: { phase, stepIndex: index, stepCount: tutorial.steps.length },
    element: null,
    satisfied: false,
    scrolled: false,
    heldSince: undefined,
  };
}

/** The State with some of its running Snapshot changed. `running` is the State's own Snapshot, narrowed by the caller. */
export function show<TStep extends Step>(
  state: State<TStep>,
  running: Running<TStep>,
  change: Partial<Running<TStep>>,
): State<TStep> {
  return { ...state, snapshot: { ...running, ...change } };
}
