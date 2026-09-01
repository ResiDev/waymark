import { end, enter, ABSENT, LOST, NO_EVENTS, quietly, SEARCHING, show } from "./state";
import type { Outcome, State } from "./state";
import { delayOf, hasWaymark, isAuto } from "./tutorial";
import type { Action, Location, Rect, Step, Tutorial } from "./types";

/**
 * Every rule in Waymark, as two pure functions over a State:
 *
 *   act(state, action)      what an Action does, and whether it is allowed
 *   observe(state, reading) what one look at the page means
 *
 * Both take a State and hand back an Outcome, and neither touches the DOM.
 * The page arrives as a Reading; elements in it are identity tokens for the
 * driver to use, never things to read from here.
 */

// ---- Actions ---------------------------------------------------------------

/** Leave the current Step: on to the next one, or to a completed Run. */
function leave<TStep extends Step>(
  state: State<TStep>,
  tutorial: Tutorial<TStep>,
): Outcome<TStep> {
  const from = state.snapshot.stepIndex;
  return from + 1 < tutorial.steps.length
    ? { state: enter(tutorial, from + 1), events: ["advance"] }
    : { state: end(tutorial, "completed", from), events: ["advance", "finish"] };
}

/** What an Action does. The one answer to "may the user do this?". */
export function act<TStep extends Step>(
  state: State<TStep>,
  action: Action,
  tutorial: Tutorial<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (action === "reset") return { state: enter(tutorial, 0), events: ["reset"] };
  if (snapshot.phase !== "running") return quietly(state);

  switch (action) {
    case "advance":
      return snapshot.canAdvance ? leave(state, tutorial) : quietly(state);
    case "previous":
      return snapshot.stepIndex === 0
        ? quietly(state)
        : { state: enter(tutorial, snapshot.stepIndex - 1), events: ["previous"] };
    case "collapse":
      return snapshot.collapsed
        ? quietly(state)
        : { state: show(state, snapshot, { collapsed: true }), events: ["collapse"] };
    case "resume":
      return snapshot.collapsed
        ? { state: show(state, snapshot, { collapsed: false }), events: ["resume"] }
        : quietly(state);
    case "exit":
      return { state: end(tutorial, "exited", snapshot.stepIndex), events: ["exit"] };
  }
}

// ---- Observation -----------------------------------------------------------

/** One coherent look at the page, taken by the driver in a single frame. */
export type Reading = Readonly<{
  element: Element | null;
  /** May be the browser's own DOMRect; it is copied only if it turns out to be news. */
  rect: Rect | null;
  /** The rect overlaps the viewport. */
  inView: boolean;
  /**
   * How the Step's Advance condition stands, this look.
   *
   * - `"unmet"` — nothing to report.
   * - `"holds"` — the Step's `state` check returned true. It may stop.
   * - `"satisfied"` — the user clicked the Waymark, or it fired one of the
   *   Step's events. This is for good: the condition never needs meeting again.
   */
  condition: "unmet" | "holds" | "satisfied";
  now: number;
}>;

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
function locate(previous: Location, reading: Reading, step: Step): Location {
  if (!hasWaymark(step)) return ABSENT;
  const rect = reading.rect;
  if (rect === null) return previous.status === "searching" ? SEARCHING : LOST;
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

/** Scroll an off-screen Waymark into view: once by default, never while collapsed. */
function scrollTarget(
  state: State,
  reading: Reading,
  step: Step,
): Element | undefined {
  if (!reading.element || !reading.rect || reading.inView) return undefined;
  if (state.snapshot.phase !== "running" || state.snapshot.collapsed) return undefined;
  if (step.scroll === "never") return undefined;
  return step.scroll === "always" || !state.scrolled ? reading.element : undefined;
}

/**
 * What one look at the page means: where the Waymark is, whether to scroll to
 * it, and whether the Advance condition has come due.
 *
 * The condition has one clock, whatever kind it is. It holds while the Step's
 * check says so, or once it has been satisfied; `heldSince` is armed when
 * holding starts and dropped the moment it stops. A satisfied condition never
 * stops holding, which is why a click still counts once its delay runs out; a
 * check that flickers starts its delay again. With no delay, holding *is*
 * being due.
 */
export function observe<TStep extends Step>(
  state: State<TStep>,
  reading: Reading,
  tutorial: Tutorial<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (snapshot.phase !== "running") return quietly(state);
  const step = snapshot.step;

  const waymark = locate(snapshot.waymark, reading, step);
  const scrollTo = scrollTarget(state, reading, step);
  const scrolled = state.scrolled || scrollTo !== undefined;
  const satisfied = state.satisfied || reading.condition === "satisfied";
  const holds = satisfied || reading.condition === "holds";
  const heldSince = holds ? (state.heldSince ?? reading.now) : undefined;

  const changed =
    waymark !== snapshot.waymark ||
    reading.element !== state.element ||
    scrolled !== state.scrolled ||
    satisfied !== state.satisfied ||
    heldSince !== state.heldSince;
  const shown = waymark === snapshot.waymark ? snapshot : { ...snapshot, waymark };
  const looked: State<TStep> = !changed
    ? state
    : { snapshot: shown, element: reading.element, satisfied, scrolled, heldSince };

  const due =
    !snapshot.canAdvance &&
    heldSince !== undefined &&
    reading.now - heldSince >= delayOf(step);
  if (!due) return { state: looked, events: NO_EVENTS, scrollTo };

  // The condition is met: move on, or just open the gate and stay.
  return isAuto(step)
    ? leave(looked, tutorial)
    : { state: show(looked, shown, { canAdvance: true }), events: NO_EVENTS, scrollTo };
}
