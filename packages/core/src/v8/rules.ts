import { end, enter, ABSENT, LOST, NO_EVENTS, noChange, SEARCHING, show } from "./state";
import type { Outcome, State } from "./state";
import { checkOf, delayOf, eventsOf, hasWaymark, isAuto } from "./walkthrough";
import type { Action, Location, Rect, Step, Walkthrough } from "./types";

/**
 * Every rule in Waymark, as three pure functions over a State:
 *
 *   act(state, action)      what an Action does, and whether it is allowed
 *   observe(state, read)    what one look at the current Step means
 *   mount(state, mounted)   what subscribers arriving or leaving means
 *
 * Each takes a State and hands back an Outcome, and none touches the DOM.
 * `apply` is the one door: it routes a Message to its rule. The page arrives
 * as a StepRead; elements in it are identity tokens for the driver to use,
 * never things to read from here. `liveWatchers`, at the end, is the one
 * pure question the driver asks about the outside: what should be live now?
 */

// ---- Messages --------------------------------------------------------------

/**
 * What waits in the driver's queue: plain data naming something that
 * happened. Because it is data, a Run is a fold over its Messages.
 */
export type Message =
  | Readonly<{ kind: "act"; action: Action }>
  | Readonly<{ kind: "read"; stepGeneration: number; read: StepRead }>
  | Readonly<{ kind: "mounted" }>
  | Readonly<{ kind: "unmounted" }>;

/** The one door. Routes a Message to its rule; a StepRead from an older Step is dropped. */
export function apply<TStep extends Step>(
  state: State<TStep>,
  message: Message,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  switch (message.kind) {
    case "act":
      return act(state, message.action, walkthrough);
    case "read":
      return message.stepGeneration === state.stepGeneration
        ? observe(state, message.read, walkthrough)
        : noChange(state);
    case "mounted":
      return mount(state, true);
    case "unmounted":
      return mount(state, false);
  }
}

// ---- Actions ---------------------------------------------------------------

/** Leave the current Step: on to the next one, or to a completed Run. */
function leave<TStep extends Step>(
  state: State<TStep>,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const from = state.snapshot.stepIndex;
  return from + 1 < walkthrough.steps.length
    ? { state: enter(walkthrough, from + 1, state), events: ["advance"] }
    : { state: end(state, "completed"), events: ["advance", "finish"] };
}

/** What an Action does. The one answer to "may the user do this?". */
export function act<TStep extends Step>(
  state: State<TStep>,
  action: Action,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  // Reset is the one Action a finished Run accepts, so it comes before the guard.
  if (action === "reset") return { state: enter(walkthrough, 0, state), events: ["reset"] };
  if (snapshot.phase !== "running") return noChange(state);

  switch (action) {
    case "advance":
      return snapshot.canAdvance ? leave(state, walkthrough) : noChange(state);
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

/**
 * One look at the current Step, taken by the driver: once a frame, or on the
 * spot when the Waymark is clicked or fires one of the Step's events.
 */
export type StepRead = Readonly<{
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

/** Scroll an off-screen Waymark into view: once by default, never while collapsed. */
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
 * What one look at the current Step means: where the Waymark is, whether to
 * scroll to it, and whether the Advance condition has come due.
 *
 * The look that starts a Run only locates. Its condition is not consulted,
 * so `start` is always announced before anything can move the Run on.
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
  read: StepRead,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (snapshot.phase !== "running") return noChange(state);
  const step = snapshot.step;
  const starting = !state.started;
  const condition = starting ? "unmet" : read.condition;

  const waymark = locate(snapshot.waymark, read, step);
  const scrollTo = scrollTarget(state, read, step);
  const scrolled = state.scrolled || scrollTo !== undefined;
  const satisfied = state.satisfied || condition === "satisfied";
  const holds = satisfied || condition === "holds";
  const heldSince = holds ? (state.heldSince ?? read.now) : undefined;

  const changed =
    starting ||
    waymark !== snapshot.waymark ||
    read.element !== state.element ||
    scrolled !== state.scrolled ||
    satisfied !== state.satisfied ||
    heldSince !== state.heldSince;
  const shown = waymark === snapshot.waymark ? snapshot : { ...snapshot, waymark };
  const looked: State<TStep> = !changed
    ? state
    : { ...state, snapshot: shown, started: true, element: read.element, satisfied, scrolled, heldSince };
  const events = starting ? ["start" as const] : NO_EVENTS;

  const due =
    !snapshot.canAdvance &&
    heldSince !== undefined &&
    read.now - heldSince >= delayOf(step);
  if (!due) return { state: looked, events, scrollTo };

  // The condition is met: move on, or just open the gate and stay.
  return isAuto(step)
    ? leave(looked, walkthrough)
    : { state: show(looked, shown, { canAdvance: true }), events, scrollTo };
}

// ---- Mounting --------------------------------------------------------------

/**
 * The first subscriber arrived, or the last one left.
 *
 * Leaving drops a `state` check's clock: no look can prove the check kept
 * holding while nobody was looking, so its delay starts over on return. A
 * satisfied click or event keeps holding, and keeps its clock.
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

// ---- Projection: what should be live, given a State -----------------------

/** The Run's hold on its Waymark: an ARIA claim, and the Step's event listeners while the gate is shut. */
export type Attachment = Readonly<{
  element: Element;
  step: Step;
  /** The Step this is for, so a Step re-entered on the same element is attached afresh. */
  stepGeneration: number;
  /** Listen for the Step's events. Nothing to hear once the gate is open. */
  listening: boolean;
  /** `aria-expanded`: the popover is showing, not collapsed. */
  expanded: boolean;
}>;

/** Which live watchers should exist. The driver opens and closes only the difference. */
export type LiveWatchers = Readonly<{
  /** The window's clicks and keys. */
  input: boolean;
  /** One animation frame, to take the next StepRead. */
  frame: boolean;
  waymark: Attachment | undefined;
}>;

const NOTHING_LIVE: LiveWatchers = { input: false, frame: false, waymark: undefined };

/**
 * Only a Mounted, running Run has anything live. It wants a frame while there
 * is something the next look could change: a Waymark to follow, or a shut
 * gate whose `state` check must be asked or whose clock must be watched.
 */
export function liveWatchers(state: State): LiveWatchers {
  const snapshot = state.snapshot;
  if (!state.mounted || snapshot.phase !== "running") return NOTHING_LIVE;
  const step = snapshot.step;
  const gateShut = !snapshot.canAdvance;
  return {
    input: true,
    frame:
      hasWaymark(step) ||
      (gateShut && (checkOf(step) !== undefined || state.heldSince !== undefined)),
    waymark:
      state.element === null
        ? undefined
        : {
            element: state.element,
            step,
            stepGeneration: state.stepGeneration,
            listening: gateShut && eventsOf(step).length > 0,
            expanded: !snapshot.collapsed,
          },
  };
}
