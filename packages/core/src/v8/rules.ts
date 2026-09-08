import type { ClickHit } from "./input";
import { end, enter, ABSENT, LOST, NO_EVENTS, noChange, SEARCHING, show } from "./state";
import type { Outcome, State } from "./state";
import { checkOf, conditionOf, delayOf, eventsOf, hasWaymark, isAuto } from "./walkthrough";
import type { Action, Location, Rect, Step, Walkthrough } from "./types";

/**
 * Pure state transitions for a walkthrough run.
 *
 * `apply` dispatches queued messages to `act`, `observe`, `satisfy`, or
 * `mount`. Each returns an Outcome with the next state, events to announce,
 * and any scroll request. The driver performs those effects.
 *
 * DOM measurements and check results arrive in StepRead. These rules compare
 * element references but never read or modify the elements themselves.
 * `liveWatchers` describes the listeners, frame, and ARIA attributes the driver
 * should maintain for the resulting state.
 */

// ---- Messages --------------------------------------------------------------

/**
 * Inputs queued by the driver. Reads, clicks, and waymark events carry a
 * step generation so stale inputs cannot affect a later step, even if it
 * uses the same element. Clicking away is an exception: it collapses the
 * current run regardless of which step received the click.
 */
export type Message =
  | Readonly<{ kind: "act"; action: Action }>
  | Readonly<{ kind: "stepRead"; stepGeneration: number; stepRead: StepRead }>
  | Readonly<{ kind: "click"; stepGeneration: number; hit: ClickHit; now: number }>
  | Readonly<{ kind: "event"; stepGeneration: number; now: number }>
  | Readonly<{ kind: "mounted" }>
  | Readonly<{ kind: "unmounted" }>;

/** Dispatch a message, checking its step generation and advance condition where needed. */
export function apply<TStep extends Step>(
  state: State<TStep>,
  message: Message,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  // A step index can repeat after reset or previous; its generation cannot.
  const stepOf = (stepGeneration: number): TStep | undefined =>
    snapshot.phase === "running" && stepGeneration === state.stepGeneration
      ? snapshot.step
      : undefined;
  switch (message.kind) {
    case "act":
      return act(state, message.action, walkthrough);
    case "stepRead":
      return stepOf(message.stepGeneration)
        ? observe(state, message.stepRead, walkthrough)
        : noChange(state);
    case "click": {
      // Collapse applies to the run, so it does not require a matching generation.
      if (message.hit === "away") return act(state, "collapse", walkthrough);
      const step = stepOf(message.stepGeneration);
      return message.hit === "waymark" && step && conditionOf(step) === "click"
        ? satisfy(state, message.now, walkthrough)
        : noChange(state);
    }
    case "event": {
      const step = stepOf(message.stepGeneration);
      return step && eventsOf(step).length > 0
        ? satisfy(state, message.now, walkthrough)
        : noChange(state);
    }
    case "mounted":
      return mount(state, true);
    case "unmounted":
      return mount(state, false);
  }
}

// ---- Actions ---------------------------------------------------------------

/** Advance to the next step, or complete the run and emit advance before finish. */
function advanceStep<TStep extends Step>(
  state: State<TStep>,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const from = state.snapshot.stepIndex;
  return from + 1 < walkthrough.steps.length
    ? { state: enter(walkthrough, from + 1, state), events: ["advance"] }
    : { state: end(state, "completed"), events: ["advance", "finish"] };
}

/** Apply an action if the current state permits it; otherwise preserve the state. */
export function act<TStep extends Step>(
  state: State<TStep>,
  action: Action,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  // Reset also applies to completed and exited runs.
  if (action === "reset") return { state: enter(walkthrough, 0, state), events: ["reset"] };
  if (snapshot.phase !== "running") return noChange(state);

  switch (action) {
    case "advance":
      return snapshot.canAdvance ? advanceStep(state, walkthrough) : noChange(state);
    case "previous":
      return snapshot.stepIndex === 0
        ? noChange(state)
        : { state: enter(walkthrough, snapshot.stepIndex - 1, state), events: ["previous"] };
    case "collapse":
      return snapshot.collapsed
        ? noChange(state)
        : { state: show(state, snapshot, { collapsed: true }), events: ["collapse"] };
    case "resume":
      return snapshot.collapsed
        ? { state: show(state, snapshot, { collapsed: false }), events: ["resume"] }
        : noChange(state);
    case "exit":
      return { state: end(state, "exited"), events: ["exit"] };
  }
}

// ---- Observation -----------------------------------------------------------

/** Measurements and check results from the driver, on subscription or an animation frame. */
export type StepRead = Readonly<{
  element: Element | null;
  /** May be a browser DOMRect. `locate` copies it when storing a new location. */
  rect: Rect | null;
  /** True when the rect overlaps the viewport, even partially. */
  inView: boolean;
  /** Whether the step's `state` check returned true for this read. */
  holds: boolean;
  /** Monotonic time in milliseconds, on the same clock as click and event messages. */
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

/**
 * Track the waymark's location for this step. A missing waymark is searching
 * until first found, then lost if it disappears. It can be found again.
 * Reuse the previous location when its geometry is unchanged.
 */
function locate(previous: Location, read: StepRead, step: Step): Location {
  if (!hasWaymark(step)) return ABSENT;
  const rect = read.rect;
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

/** Request scrolling for an off-screen waymark according to `step.scroll`, unless collapsed. */
function scrollTarget(
  state: State,
  read: StepRead,
  step: Step,
): Element | undefined {
  if (!read.element || !read.rect || read.inView) return undefined;
  if (state.snapshot.phase !== "running" || state.snapshot.collapsed) return undefined;
  if (step.scroll === "never") return undefined;
  return step.scroll === "always" || !state.scrolled ? read.element : undefined;
}

/**
 * Once the advance condition's delay has elapsed, advance automatically or
 * set canAdvance for `then: "unlock"`. Preserve the outcome while waiting
 * or if advancement is already unlocked.
 */
function whenDue<TStep extends Step>(
  outcome: Outcome<TStep>,
  now: number,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const { state } = outcome;
  const snapshot = state.snapshot;
  if (
    snapshot.phase !== "running" ||
    snapshot.canAdvance ||
    state.heldSince === undefined ||
    now - state.heldSince < delayOf(snapshot.step)
  ) {
    return outcome;
  }
  return isAuto(snapshot.step)
    ? advanceStep(state, walkthrough)
    : { ...outcome, state: show(state, snapshot, { canAdvance: true }) };
}

/**
 * Update the waymark's location, request scrolling if needed, and check
 * whether the advance condition's delay has elapsed.
 *
 * The run's first read emits `start` and ignores the state check. This lets
 * subscribers receive the initial location before a condition can advance
 * the run. Scrolling can still be requested on this read.
 *
 * `heldSince` records when the condition began holding. A false state check
 * clears it, so the next true result starts the full delay again. A click or
 * event recorded by `satisfy` stays satisfied for the rest of the step.
 */
export function observe<TStep extends Step>(
  state: State<TStep>,
  read: StepRead,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (snapshot.phase !== "running") return noChange(state);
  const step = snapshot.step;
  const starting = !state.started;

  const waymark = locate(snapshot.waymark, read, step);
  const scrollTo = scrollTarget(state, read, step);
  const scrolled = state.scrolled || scrollTo !== undefined;
  const holds = state.satisfied || (!starting && read.holds);
  const heldSince = holds ? (state.heldSince ?? read.now) : undefined;

  const changed =
    starting ||
    waymark !== snapshot.waymark ||
    read.element !== state.element ||
    scrolled !== state.scrolled ||
    heldSince !== state.heldSince;
  const shown = waymark === snapshot.waymark ? snapshot : { ...snapshot, waymark };
  const looked: State<TStep> = !changed
    ? state
    : { ...state, snapshot: shown, started: true, element: read.element, scrolled, heldSince };
  const events = starting ? ["start" as const] : NO_EVENTS;

  return whenDue({ state: looked, events, scrollTo }, read.now, walkthrough);
}

/**
 * Record a matching click or event for the current step. Repeated inputs
 * preserve the original delay start time. With no delay, advance or unlock
 * immediately; otherwise `observe` checks the delay on subsequent frames.
 * Ignore inputs before the first read has emitted `start`.
 */
export function satisfy<TStep extends Step>(
  state: State<TStep>,
  now: number,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  if (state.snapshot.phase !== "running" || !state.started) return noChange(state);
  const held = state.satisfied
    ? state
    : { ...state, satisfied: true, heldSince: state.heldSince ?? now };
  return whenDue(noChange(held), now, walkthrough);
}

// ---- Mounting --------------------------------------------------------------

/**
 * Update whether the run has subscribers.
 *
 * When the last subscriber leaves, clear a state check's delay start time.
 * Checks stop without subscribers, so continuous truth cannot be verified.
 * A satisfied click or event keeps its start time across unmounting.
 */
export function mount<TStep extends Step>(
  state: State<TStep>,
  mounted: boolean,
): Outcome<TStep> {
  if (state.mounted === mounted) return noChange(state);
  const snapshot = state.snapshot;
  const dropClock =
    !mounted &&
    snapshot.phase === "running" &&
    !state.satisfied &&
    checkOf(snapshot.step) !== undefined;
  return {
    state: { ...state, mounted, heldSince: dropClock ? undefined : state.heldSince },
    events: NO_EVENTS,
  };
}

// ---- Driver subscriptions --------------------------------------------------

/** ARIA attributes to maintain on the current waymark. */
export type WaymarkAria = Readonly<{
  element: Element;
  expanded: boolean;
}>;

/** Advance-condition events to listen for during this visit to the step. */
export type WaymarkEvents = Readonly<{
  element: Element;
  events: readonly string[];
  stepGeneration: number;
}>;

export const sameWaymarkAria = (a: WaymarkAria, b: WaymarkAria): boolean =>
  a.element === b.element && a.expanded === b.expanded;

export const sameWaymarkEvents = (a: WaymarkEvents, b: WaymarkEvents): boolean =>
  a.element === b.element &&
  a.stepGeneration === b.stepGeneration &&
  a.events.length === b.events.length &&
  a.events.every((event, index) => event === b.events[index]);

/** Resources the driver should keep active, reconciled after each message. */
export type LiveWatchers = Readonly<{
  /** Listen for window click and keydown events. */
  input: boolean;
  /** Schedule an animation frame for the next StepRead. */
  frame: boolean;
  waymarkAria: WaymarkAria | undefined;
  waymarkEvents: WaymarkEvents | undefined;
}>;

const NOTHING_LIVE: LiveWatchers = {
  input: false,
  frame: false,
  waymarkAria: undefined,
  waymarkEvents: undefined,
};

/**
 * Keep resources active only while the run is running and has subscribers.
 * Request frames to track a waymark, evaluate a state check, or wait for a
 * condition's delay. Once advancement is unlocked, only waymark tracking
 * needs further frames.
 */
export function liveWatchers(state: State): LiveWatchers {
  const snapshot = state.snapshot;
  if (!state.mounted || snapshot.phase !== "running") return NOTHING_LIVE;
  const step = snapshot.step;
  const gateShut = !snapshot.canAdvance;
  const events = eventsOf(step);
  return {
    input: true,
    frame:
      hasWaymark(step) ||
      (gateShut && (checkOf(step) !== undefined || state.heldSince !== undefined)),
    waymarkAria:
      state.element === null
        ? undefined
        : { element: state.element, expanded: !snapshot.collapsed },
    waymarkEvents:
      state.element !== null && gateShut && events.length > 0
        ? { element: state.element, events, stepGeneration: state.stepGeneration }
        : undefined,
  };
}
