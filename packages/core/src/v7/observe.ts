import type { Outcome } from "./outcome";
import { ABSENT, LOST, SEARCHING } from "./state";
import type { Definition, State } from "./state";
import { meetCondition } from "./transitions";
import { selectorFor } from "./tutorial";
import type { AdvanceRule } from "./tutorial";
import type { Location, Rect, Step } from "./types";

/**
 * What one look at the page means. The only file that answers "where is the
 * Waymark?", "should we scroll to it?" and "has the condition come due?".
 *
 * It never touches the DOM: the page arrives as a Reading, and elements are
 * identity tokens the driver will use, not things to read from here.
 */

/** One coherent sample of the page, taken by the driver in a single frame. */
export type Reading = Readonly<{
  element: Element | null;
  rect: Rect | null;
  /** The rect overlaps the viewport. */
  inView: boolean;
  /** The Step's `state` predicate, already run by the driver. */
  conditionHolds: boolean;
  now: number;
}>;

const sameLocation = (a: Location, b: Location): boolean => {
  if (a.status !== b.status) return false;
  if (a.status !== "found" || b.status !== "found") return true;
  return (
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
};

/** Searching → found → lost. A Waymark once seen is never searching again. */
function locate(state: State, reading: Reading, step: Step): Location {
  if (selectorFor(step) === undefined) return ABSENT;
  const seen: Location = reading.rect
    ? { status: "found", rect: reading.rect }
    : state.location.status === "searching"
      ? SEARCHING
      : LOST;
  return sameLocation(seen, state.location) ? state.location : seen;
}

/** Scroll an off-screen Waymark into view: once by default, never collapsed. */
function scrollTarget(
  state: State,
  reading: Reading,
  step: Step,
): Element | undefined {
  if (!reading.element || !reading.rect || reading.inView) return undefined;
  if (state.collapsed || step.scroll === "never") return undefined;
  return step.scroll === "always" || !state.hasScrolled
    ? reading.element
    : undefined;
}

/**
 * The condition's clock. A `state` check arms it while it holds and disarms it
 * the moment it stops — the check must still hold when the delay runs out. A
 * click or Waymark event arms it instead, and nothing here may disarm that.
 */
function clock(
  state: State,
  reading: Reading,
  rule: AdvanceRule | undefined,
): number | undefined {
  if (!rule?.byCheck) return state.dueAt;
  return reading.conditionHolds
    ? (state.dueAt ?? reading.now + rule.delayMs)
    : undefined;
}

export function observe(
  state: State,
  reading: Reading,
  definition: Definition,
): Outcome {
  if (state.phase !== "running") return { state, announcements: [] };

  const step = definition.steps[state.index];
  const rule = definition.rules[state.index];

  const location = locate(state, reading, step);
  const scrollTo = scrollTarget(state, reading, step);
  const hasScrolled = state.hasScrolled || scrollTo !== undefined;
  const dueAt = clock(state, reading, rule);

  const moved =
    location !== state.location ||
    reading.element !== state.element ||
    hasScrolled !== state.hasScrolled ||
    dueAt !== state.dueAt;
  const looked: State = moved
    ? { ...state, location, element: reading.element, hasScrolled, dueAt }
    : state;

  const due =
    rule !== undefined &&
    !looked.conditionMet &&
    looked.dueAt !== undefined &&
    reading.now >= looked.dueAt;

  return due
    ? { ...meetCondition(looked, rule, definition), scrollTo }
    : { state: looked, announcements: [], scrollTo };
}
