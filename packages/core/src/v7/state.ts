import { selectorFor } from "./tutorial";
import type { AdvanceRule } from "./tutorial";
import type { Location, Snapshot, Step } from "./types";

/**
 * The whole of what a Run knows. `console.log(state)` shows all of it.
 *
 * Only `enterStep` and `ended` build one from scratch; everything else copies
 * an existing State and changes a field. That is what keeps the per-Step
 * scratch below from outliving its Step.
 */
export type State = Readonly<{
  phase: "running" | "completed" | "exited";
  index: number;
  collapsed: boolean;
  /** The current Step's Advance condition has been met. Latches for the Step. */
  conditionMet: boolean;
  /** Where the Waymark is. Replaced only when it has actually moved. */
  location: Location;

  // ---- per-Step scratch: reset by entering a Step, dropped by ending ----

  /** The Waymark element, kept as an identity token. Never read here. */
  element: Element | null;
  /** A `scroll: "once"` Step has had its one scroll. */
  hasScrolled: boolean;
  /** When the Advance condition falls due, once something has started its clock. */
  dueAt: number | undefined;
}>;

/** The Tutorial with each Step's Advance rule worked out once, up front. */
export type Definition<TStep extends Step = Step> = Readonly<{
  steps: readonly TStep[];
  rules: readonly (AdvanceRule | undefined)[];
}>;

/** The Locations that carry no rect, shared so that comparing them is cheap. */
export const ABSENT: Location = { status: "absent" };
export const SEARCHING: Location = { status: "searching" };
export const LOST: Location = { status: "lost" };

/** Entering a Step *is* this object: a fresh State, so no scratch survives. */
export function enterStep(index: number, definition: Definition): State {
  return {
    phase: "running",
    index,
    collapsed: false,
    conditionMet: false,
    location:
      selectorFor(definition.steps[index]) === undefined ? ABSENT : SEARCHING,
    element: null,
    hasScrolled: false,
    dueAt: undefined,
  };
}

/** A Run that is over. No Step is current, so it holds no scratch at all. */
export function ended(phase: "completed" | "exited", index: number): State {
  return {
    phase,
    index,
    collapsed: false,
    conditionMet: false,
    location: ABSENT,
    element: null,
    hasScrolled: false,
    dueAt: undefined,
  };
}

/** A Step that states an Advance condition keeps its gate shut until it is met. */
export function canAdvance(state: State, definition: Definition): boolean {
  return (
    state.phase === "running" &&
    (state.conditionMet || definition.rules[state.index] === undefined)
  );
}

/** What a renderer sees: pure over (State, Definition), rebuilt only when it changes. */
export function buildSnapshot<TStep extends Step>(
  state: State,
  definition: Definition<TStep>,
): Snapshot<TStep> {
  const steps = definition.steps;
  return state.phase === "running"
    ? {
        phase: "running",
        step: steps[state.index],
        stepIndex: state.index,
        stepCount: steps.length,
        canAdvance: canAdvance(state, definition),
        collapsed: state.collapsed,
        waymark: state.location,
      }
    : { phase: state.phase, stepIndex: state.index, stepCount: steps.length };
}

/** True when two States produce identical Snapshots — scratch is invisible. */
export function rendersTheSame(a: State, b: State): boolean {
  return (
    a.phase === b.phase &&
    a.index === b.index &&
    a.collapsed === b.collapsed &&
    a.conditionMet === b.conditionMet &&
    a.location === b.location
  );
}
