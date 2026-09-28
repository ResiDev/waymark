import type { ClickHit } from "./input";
import { end, enter, ABSENT, LOST, NO_EVENTS, noChange, SEARCHING, show } from "./state";
import type { Outcome, State } from "./state";
import { checkOf, delayOf, eventsOf, hasWaymark, isAuto, isClick } from "../walkthrough/walkthrough";
import type { Action, Location, Rect } from "./types";
import type { Step, Walkthrough } from "../walkthrough/types";

/**
 * Reads, clicks and Waymark events carry the step generation they were raised
 * in, so one queued behind a step change cannot act on the next step, even one
 * on the same element.
 */
export type Message =
  | Readonly<{ kind: "act"; action: Action }>
  | Readonly<{ kind: "stepRead"; stepGeneration: number; stepRead: StepRead }>
  | Readonly<{ kind: "start" }>
  | Readonly<{ kind: "click"; stepGeneration: number; hit: ClickHit; now: number }>
  | Readonly<{ kind: "event"; stepGeneration: number; now: number }>
  | Readonly<{ kind: "mounted" }>
  | Readonly<{ kind: "unmounted" }>;

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

function advanceStep<TStep extends Step>(
  state: State<TStep>,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const from = state.snapshot.stepIndex;
  return from + 1 < walkthrough.steps.length
    ? { state: enter(walkthrough, from + 1, state), events: ["advance"] }
    : { state: end(state, "completed"), events: ["advance", "finish"] };
}

function act<TStep extends Step>(
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

export type WaymarkRead = Readonly<{
  element: Element | null;
  rect: Rect | null;
  inView: boolean;
}>;

export type AdvanceRead = Readonly<{
  holds: boolean;
  now: number;
}>;

export type StepRead = Readonly<{
  waymark?: WaymarkRead | undefined;
  advance?: AdvanceRead | undefined;
}>;

// A DOMRect's fields are getters on its prototype, which spread and
// `Object.keys` do not see; a Snapshot holds a plain object.
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

// Hands back the same Location object whenever nothing moved. A new one each
// frame would make a new Snapshot, and notify subscribers, every frame.
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

function observeWaymark<TStep extends Step>(
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

function observeAdvance<TStep extends Step>(
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

// The scroll request is dropped if the check moved the Run to another step:
// there is no point scrolling to a Waymark just left.
function observe<TStep extends Step>(
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

function start<TStep extends Step>(state: State<TStep>): Outcome<TStep> {
  return state.started || state.snapshot.phase !== "running"
    ? noChange(state)
    : { state: { ...state, started: true }, events: ["start"] };
}

function satisfy<TStep extends Step>(
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

function mount<TStep extends Step>(
  state: State<TStep>,
  mounted: boolean,
): Outcome<TStep> {
  if (state.mounted === mounted) return noChange(state);
  const snapshot = state.snapshot;
  // No frames run without a subscriber, so a `state` check cannot be shown to
  // have held throughout and its delay starts again. A click already counts.
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

export type WaymarkAria = Readonly<{
  element: Element;
  expanded: boolean;
}>;

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

export type LiveWatchers = Readonly<{
  input: boolean;
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

export function needsAdvanceRead(state: State): boolean {
  const snapshot = state.snapshot;
  return state.mounted && state.started && snapshot.phase === "running" &&
    !snapshot.canAdvance &&
    (checkOf(snapshot.step) !== undefined || state.heldSince !== undefined);
}

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
