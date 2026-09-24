import type { ClickHit } from "./input";
import { end, enter, ABSENT, LOST, NO_EVENTS, noChange, SEARCHING, show } from "./state";
import type { Outcome, State } from "./state";
import { checkOf, delayOf, eventsOf, hasWaymark, isAuto, isClick } from "./walkthrough";
import type { Action, Location, Rect, Step, Walkthrough } from "./types";

/**
 * Pure state transitions for a walkthrough run.
 *
 * `apply` dispatches queued messages to the action, observation, startup,
 * and subscription rules. Each returns an Outcome with the next state,
 * events to announce, and any scroll request. The driver performs those effects.
 *
 * DOM measurements arrive in WaymarkRead; check results arrive in AdvanceRead.
 * These rules compare element references but never read or modify the elements.
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
  | Readonly<{ kind: "start" }>
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
    case "start":
      return start(state);
    case "click": {
      // Collapse applies to the run, so it does not require a matching generation.
      if (message.hit === "away") return act(state, "collapse", walkthrough);
      const step = stepOf(message.stepGeneration);
      return message.hit === "waymark" && step && isClick(step)
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

/** The waymark element and its geometry, measured by the driver. */
export type WaymarkRead = Readonly<{
  element: Element | null;
  /** May be a browser DOMRect. `locate` copies it when storing a new location. */
  rect: Rect | null;
  /** True when the rect overlaps the viewport, even partially. */
  inView: boolean;
}>;

/** An advance check result and the time used to evaluate its delay. */
export type AdvanceRead = Readonly<{
  /** Whether the step's `state` check returned true for this read. */
  holds: boolean;
  /** Monotonic time in milliseconds, on the same clock as click and event messages. */
  now: number;
}>;

/**
 * One look at the current step, taken on subscription or an animation frame.
 * The driver includes only the parts the state needs: no measurement for a
 * step without a waymark, and no check once advancement is unlocked. The
 * check is run on the element this same look measured.
 */
export type StepRead = Readonly<{
  waymark?: WaymarkRead | undefined;
  advance?: AdvanceRead | undefined;
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
function locate(previous: Location, read: WaymarkRead, step: Step): Location {
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
  read: WaymarkRead,
  step: Step,
): Element | undefined {
  if (!read.element || !read.rect || read.inView) return undefined;
  if (state.snapshot.phase !== "running" || state.snapshot.collapsed) return undefined;
  if (step.scroll === "never") return undefined;
  return step.scroll === "always" || !state.scrolled ? read.element : undefined;
}

/**
 * Once the advance condition's delay has elapsed, advance automatically or
 * set canAdvance for `then: "unlock"`. Preserve the state while waiting
 * or if advancement is already unlocked.
 */
function whenDue<TStep extends Step>(
  state: State<TStep>,
  now: number,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (
    snapshot.phase !== "running" ||
    snapshot.canAdvance ||
    state.heldSince === undefined ||
    now - state.heldSince < delayOf(snapshot.step)
  ) {
    return noChange(state);
  }
  return isAuto(snapshot.step)
    ? advanceStep(state, walkthrough)
    : { state: show(state, snapshot, { canAdvance: true }), events: NO_EVENTS };
}

/** Update the waymark's location and request scrolling without changing advancement. */
export function observeWaymark<TStep extends Step>(
  state: State<TStep>,
  read: WaymarkRead,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (snapshot.phase !== "running") return noChange(state);
  const waymark = locate(snapshot.waymark, read, snapshot.step);
  const scrollTo = scrollTarget(state, read, snapshot.step);
  const scrolled = state.scrolled || scrollTo !== undefined;
  const changed =
    waymark !== snapshot.waymark ||
    read.element !== state.element ||
    scrolled !== state.scrolled;
  const shown = waymark === snapshot.waymark ? snapshot : { ...snapshot, waymark };
  return {
    state: changed ? { ...state, snapshot: shown, element: read.element, scrolled } : state,
    events: NO_EVENTS,
    scrollTo,
  };
}

/**
 * Update the condition timer and advance or unlock when its delay expires.
 * A false check resets the delay; a satisfied click or event keeps holding.
 * Waymark measurements do not affect this timer.
 */
export function observeAdvance<TStep extends Step>(
  state: State<TStep>,
  read: AdvanceRead,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  if (state.snapshot.phase !== "running" || !state.started || state.snapshot.canAdvance) {
    return noChange(state);
  }
  const holds = state.satisfied || read.holds;
  const heldSince = holds ? (state.heldSince ?? read.now) : undefined;
  const held = heldSince === state.heldSince ? state : { ...state, heldSince };
  return whenDue(held, read.now, walkthrough);
}

/**
 * Apply the waymark measurement, then the advance check, as one change.
 * The scroll request survives arming the clock or unlocking, but not
 * leaving the step: there is no point scrolling to a waymark just left.
 */
export function observe<TStep extends Step>(
  state: State<TStep>,
  read: StepRead,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const seen = read.waymark ? observeWaymark(state, read.waymark) : noChange(state);
  if (read.advance === undefined) return seen;
  const due = observeAdvance(seen.state, read.advance, walkthrough);
  if (due.state === seen.state) return seen;
  return due.state.stepGeneration === seen.state.stepGeneration
    ? { ...due, scrollTo: seen.scrollTo }
    : due;
}

/** Announce startup once, after any initial waymark measurement has been applied. */
export function start<TStep extends Step>(state: State<TStep>): Outcome<TStep> {
  return state.started || state.snapshot.phase !== "running"
    ? noChange(state)
    : { state: { ...state, started: true }, events: ["start"] };
}

/**
 * Record a matching click or event for the current step. Repeated inputs
 * preserve the original delay start time. With no delay, advance or unlock
 * immediately; otherwise `observeAdvance` checks the delay on subsequent frames.
 * Ignore inputs before startup has emitted `start`.
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
  return whenDue(held, now, walkthrough);
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

/** A state check or pending delay still needs looking at, so a StepRead should carry an AdvanceRead. */
export function needsAdvanceRead(state: State): boolean {
  const snapshot = state.snapshot;
  return state.mounted && state.started && snapshot.phase === "running" &&
    !snapshot.canAdvance &&
    (checkOf(snapshot.step) !== undefined || state.heldSince !== undefined);
}

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
    frame: hasWaymark(step) || needsAdvanceRead(state),
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
