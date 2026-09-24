import { hasWaymark } from "../walkthrough/walkthrough";
import type { Location, RunEventType, Running, Snapshot } from "./types";
import type { Step, Walkthrough } from "../walkthrough/types";

/**
 * The whole of what a Run knows.
 *
 * It is the Snapshot a renderer sees, two facts about the Run as a whole that
 * no renderer sees, and Scratch about the current Step. The Snapshot is held,
 * not derived: a rule that changes something visible makes a new Snapshot,
 * and one that only touches the rest leaves the old one in place. So the
 * driver has one question to ask after any rule — "is the Snapshot the same
 * object?" — and that answers both "should I notify?" and "does the renderer
 * need a new read?".
 *
 * Only `enter` and `end` build a State from nothing; every rule copies one
 * and changes a field. That is what keeps Scratch from outliving its Step,
 * and what carries the Run-wide facts from one Step to the next.
 */
export type State<TStep extends Step = Step> = Readonly<{
  snapshot: Snapshot<TStep>;
  /**
   * Increments when entering or ending a step, including reset and returning
   * to the same index. Reads stamped with an older generation are ignored.
   */
  stepGeneration: number;

  // ---- About the Run as a whole; carried from Step to Step -----------------

  /** `start` has been announced. Once per Run: reset does not repeat it. */
  started: boolean;
  /** Someone is subscribed. The one fact about the outside a rule needs. */
  mounted: boolean;

  // ---- Scratch: about the current Step; reset by entering one -------------

  /** The Waymark element. Kept so the next look does not search, and so the driver can attach to it. */
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
  scrollTo?: Element | undefined;
}>;

/** Shared by every Outcome with nothing to say, so quiet frames allocate less. */
export const NO_EVENTS: readonly RunEventType[] = [];

/** Preserve the state without events or scrolling. */
export const noChange = <TStep extends Step>(
  state: State<TStep>,
): Outcome<TStep> => ({
  state,
  events: NO_EVENTS,
});

/** The Locations that carry no rect, shared so that comparing them is cheap. */
export const ABSENT: Location = { status: "absent" };
export const SEARCHING: Location = { status: "searching" };
export const LOST: Location = { status: "lost" };

/**
 * A fresh State for a Step. With a `previous` State the Run-wide facts carry
 * over and the step generation moves on; without one, this is the Run's first.
 */
export function enter<TStep extends Step>(
  walkthrough: Walkthrough<TStep>,
  index: number,
  previous?: State<TStep>,
): State<TStep> {
  const step = walkthrough.steps[index];
  if (step === undefined) throw new RangeError(`No step at index ${index}.`);
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

/** A Run that is over. No Step is current, so it holds no Scratch at all. */
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

/** The State with some of its running Snapshot changed. `running` is the State's own Snapshot, narrowed by the caller. */
export function show<TStep extends Step>(
  state: State<TStep>,
  running: Running<TStep>,
  change: Partial<Running<TStep>>,
): State<TStep> {
  return { ...state, snapshot: { ...running, ...change } };
}
