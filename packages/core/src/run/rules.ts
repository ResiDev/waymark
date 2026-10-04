import type { ClickHit } from "./input";
import {
  begin,
  end,
  enter,
  gate,
  isGone,
  ABSENT,
  LOST,
  WAITING,
  MISSING,
  NO_EVENTS,
  noChange,
  show,
} from "./state";
import type { Outcome, Start, State } from "./state";
import {
  checkOf,
  delayOf,
  eventsOf,
  hasWaymark,
  isAuto,
  isClick,
} from "../walkthrough/walkthrough";
import type { Action, Location, Rect, RunEventType, Running } from "./types";
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
  | Readonly<{
      kind: "click";
      stepGeneration: number;
      hit: ClickHit;
      now: number;
    }>
  | Readonly<{ kind: "event"; stepGeneration: number; now: number }>
  | Readonly<{ kind: "mounted" }>
  | Readonly<{ kind: "unmounted" }>
  | Readonly<{ kind: "loaded"; start: Start }>;

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
    case "loaded":
      return state.snapshot.phase === "loading"
        ? { state: begin(walkthrough, message.start, state), events: NO_EVENTS }
        : noChange(state);
  }
}

function advanceStep<TStep extends Step>(
  state: State<TStep>,
  running: Running<TStep>,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const from = running.stepIndex;
  return from + 1 < walkthrough.steps.length
    ? { state: enter(walkthrough, from + 1, state), events: ["advance"] }
    : { state: end(state, running, "completed"), events: ["advance", "finish"] };
}

function act<TStep extends Step>(
  state: State<TStep>,
  action: Action,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  // Reset also applies to completed and exited runs. A loading Run has nothing to reset yet.
  if (action === "reset") {
    return snapshot.phase === "loading"
      ? noChange(state)
      : { state: enter(walkthrough, 0, state), events: ["reset"] };
  }
  if (snapshot.phase !== "running") return noChange(state);

  switch (action) {
    case "advance":
      return snapshot.canAdvance
        ? advanceStep(state, snapshot, walkthrough)
        : noChange(state);
    case "previous":
      return snapshot.stepIndex === 0
        ? noChange(state)
        : {
            state: enter(walkthrough, snapshot.stepIndex - 1, state),
            events: ["previous"],
          };
    case "collapse":
      return snapshot.collapsed
        ? noChange(state)
        : {
            state: show(state, snapshot, { collapsed: true }),
            events: ["collapse"],
          };
    case "resume":
      return snapshot.collapsed
        ? {
            state: show(state, snapshot, { collapsed: false }),
            events: ["resume"],
          }
        : noChange(state);
    case "exit":
      return { state: end(state, snapshot, "exited"), events: ["exit"] };
  }
}

export type WaymarkRead = Readonly<{
  element: Element | null;
  rect: Rect | null;
  inView: boolean;
}>;

/** How long, in ms, a Waymark is searched for before its Step shows without it. */
const WAITING_AFTER = 500;

/**
 * How long, in ms, a Waymark may be searched for before it counts as missing,
 * unless its Step says: long enough for a screen to fetch what it shows.
 */
const MISSING_AFTER = 3000;

/** How long, in ms, a found Waymark may be gone before it counts as lost: long enough for a re-render that swaps its element. */
const LOST_AFTER = 200;

export type AdvanceRead = Readonly<{
  holds: boolean;
}>;

export type StepRead = Readonly<{
  now: number;
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
function foundAt(previous: Location, rect: Rect): Location {
  const unmoved =
    previous.status === "found" &&
    previous.rect.x === rect.x &&
    previous.rect.y === rect.y &&
    previous.rect.width === rect.width &&
    previous.rect.height === rect.height;
  return unmoved ? previous : { status: "found", rect: copyRect(rect) };
}

type Located = Readonly<{
  waymark: Location;
  unseenSince: number | undefined;
}>;

/**
 * A Waymark never found is waiting after `WAITING_AFTER`, and missing after its
 * Step's `missingAfterMs`. One found is lost after `LOST_AFTER`, and keeps its
 * last place until then.
 */
function locate(
  previous: Location,
  unseenSince: number | undefined,
  read: WaymarkRead,
  now: number,
  step: Step,
): Located {
  if (!hasWaymark(step)) return { waymark: ABSENT, unseenSince: undefined };
  if (read.rect !== null) {
    return { waymark: foundAt(previous, read.rect), unseenSince: undefined };
  }
  if (previous.status === "absent" || isGone(previous)) {
    return { waymark: previous, unseenSince: undefined };
  }
  const since = unseenSince ?? now;
  const unseen = now - since;
  if (previous.status === "found") {
    return unseen < LOST_AFTER
      ? { waymark: previous, unseenSince: since }
      : { waymark: LOST, unseenSince: undefined };
  }
  if (unseen >= (step.missingAfterMs ?? MISSING_AFTER)) {
    return { waymark: MISSING, unseenSince: undefined };
  }
  return { waymark: unseen < WAITING_AFTER ? previous : WAITING, unseenSince: since };
}

function scrollTarget(
  state: State,
  read: WaymarkRead,
  step: Step,
): Element | undefined {
  if (!read.element || !read.rect || read.inView) return undefined;
  if (state.snapshot.phase !== "running" || state.snapshot.collapsed)
    return undefined;
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
    state.unlocked ||
    state.heldSince === undefined ||
    now - state.heldSince < delayOf(snapshot.step)
  ) {
    return noChange(state);
  }
  return isAuto(snapshot.step)
    ? advanceStep(state, snapshot, walkthrough)
    : { state: gate(state, snapshot, { unlocked: true }), events: NO_EVENTS };
}

/** Once, as the Waymark goes, not on every frame it stays gone. */
const goneEvents = (before: Location, after: Location): readonly RunEventType[] =>
  after !== before && isGone(after) ? [after.status] : NO_EVENTS;

function observeWaymark<TStep extends Step>(
  state: State<TStep>,
  read: WaymarkRead,
  now: number,
): Outcome<TStep> {
  const snapshot = state.snapshot;
  if (snapshot.phase !== "running") return noChange(state);

  const { waymark, unseenSince } = locate(
    snapshot.waymark,
    state.unseenSince,
    read,
    now,
    snapshot.step,
  );
  const scrollTo = scrollTarget(state, read, snapshot.step);
  const scrolled = state.scrolled || scrollTo !== undefined;

  // The same State when nothing changed, so the driver sees no change to notify.
  if (
    waymark === snapshot.waymark &&
    read.element === state.element &&
    scrolled === state.scrolled &&
    unseenSince === state.unseenSince
  ) {
    return { state, events: NO_EVENTS, scrollTo };
  }

  const located =
    waymark === snapshot.waymark
      ? state
      : gate(state, snapshot, { waymark });
  return {
    state: { ...located, element: read.element, scrolled, unseenSince },
    events: goneEvents(snapshot.waymark, waymark),
    scrollTo,
  };
}

function observeAdvance<TStep extends Step>(
  state: State<TStep>,
  read: AdvanceRead,
  now: number,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  if (state.snapshot.phase !== "running" || !state.started || state.unlocked) {
    return noChange(state);
  }
  const holds = state.satisfied || read.holds;
  const heldSince = holds ? (state.heldSince ?? now) : undefined;
  const held = heldSince === state.heldSince ? state : { ...state, heldSince };
  return whenDue(held, now, walkthrough);
}

// The scroll request is dropped if the check moved the Run to another step:
// there is no point scrolling to a Waymark just left.
function observe<TStep extends Step>(
  state: State<TStep>,
  read: StepRead,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  const seen = read.waymark
    ? observeWaymark(state, read.waymark, read.now)
    : noChange(state);
  if (read.advance === undefined) return seen;
  const due = observeAdvance(seen.state, read.advance, read.now, walkthrough);
  if (due.state === seen.state) return seen;
  const events = [...seen.events, ...due.events];
  return due.state.stepGeneration === seen.state.stepGeneration
    ? { ...due, events, scrollTo: seen.scrollTo }
    : { ...due, events };
}

function start<TStep extends Step>(state: State<TStep>): Outcome<TStep> {
  return state.started || state.snapshot.phase !== "running"
    ? noChange(state)
    : { state: { ...state, started: true }, events: state.resumed ? NO_EVENTS : ["start"] };
}

function satisfy<TStep extends Step>(
  state: State<TStep>,
  now: number,
  walkthrough: Walkthrough<TStep>,
): Outcome<TStep> {
  if (state.snapshot.phase !== "running" || !state.started)
    return noChange(state);
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
    state: {
      ...state,
      mounted,
      heldSince: dropClock ? undefined : state.heldSince,
      // Nobody looked while unmounted, so that time does not count towards missing or lost.
      unseenSince: mounted ? state.unseenSince : undefined,
    },
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

export const sameWaymarkEvents = (
  a: WaymarkEvents,
  b: WaymarkEvents,
): boolean =>
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
  return (
    state.mounted &&
    state.started &&
    snapshot.phase === "running" &&
    !state.unlocked &&
    (checkOf(snapshot.step) !== undefined || state.heldSince !== undefined)
  );
}

export function liveWatchers(state: State): LiveWatchers {
  const snapshot = state.snapshot;
  if (!state.mounted || snapshot.phase !== "running") return NOTHING_LIVE;
  const step = snapshot.step;
  const conditionUnmet = !state.unlocked;
  const events = eventsOf(step);
  return {
    input: true,
    frame: hasWaymark(step) || needsAdvanceRead(state),
    waymarkAria:
      state.element === null
        ? undefined
        : { element: state.element, expanded: !snapshot.collapsed },
    waymarkEvents:
      state.element !== null && conditionUnmet && events.length > 0
        ? {
            element: state.element,
            events,
            stepGeneration: state.stepGeneration,
          }
        : undefined,
  };
}
