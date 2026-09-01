import { NOTHING } from "./outcome";
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

/**
 * The Reading's rect may be the browser's own DOMRect; it is compared first
 * and copied into plain data only when it turns out to be news, so a still
 * frame allocates nothing here.
 */
const copyRect = (rect: Rect): Rect => ({
  x: rect.x,
  y: rect.y,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
  width: rect.width,
  height: rect.height,
});

/** Searching → found → lost. A Waymark once seen is never searching again. */
function locate(state: State, reading: Reading, step: Step): Location {
  if (selectorFor(step) === undefined) return ABSENT;
  const rect = reading.rect;
  if (rect === null) {
    return state.location.status === "searching" ? SEARCHING : LOST;
  }
  const previous = state.location;
  if (
    previous.status === "found" &&
    previous.rect.x === rect.x &&
    previous.rect.y === rect.y &&
    previous.rect.width === rect.width &&
    previous.rect.height === rect.height
  ) {
    return previous;
  }
  return { status: "found", rect: copyRect(rect) };
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
    : { state: looked, announcements: NOTHING, scrollTo };
}
