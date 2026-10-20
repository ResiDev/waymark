import type { ClickHit } from "./input";
import {
  end,
  enter,
  gate,
  isGone,
  ABSENT,
  LOST,
  SEARCHING,
  WAITING,
  MISSING,
  NO_EVENTS,
  noChange,
  show,
} from "./state";
import type { Outcome, State } from "./state";
import {
  checkOf,
  delayOf,
  eventsOf,
  hasWaymark,
  isAuto,
  isClick,
} from "../walkthrough/walkthrough";
import type { Action, Location, Rect, Running } from "./types";
import type { Step, Walkthrough } from "../walkthrough/types";

/**
 * Reads, clicks and Waymark events carry the step generation they were raised
 * in, so one queued behind a step change cannot act on the next step, even one
 * on the same element.
 */
export type Message =
  | Readonly<{ kind: "act"; action: Action }>
  | Readonly<{ kind: "stepRead"; stepGeneration: number; stepRead: StepRead }>
  | Readonly<{ kind: "start"; stepGeneration: number }>
  | Readonly<{
      kind: "click";
      stepGeneration: number;
      hit: ClickHit;
      now: number;
    }>
  | Readonly<{ kind: "event"; stepGeneration: number; now: number }>
  | Readonly<{ kind: "attached" }>
  | Readonly<{ kind: "detached" }>;

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
      return stepOf(message.stepGeneration) ? start(state) : noChange(state);
    case "click": {
      // Dismissing applies to the walkthrough, so it does not require a matching generation.
      if (message.hit === "away") return act(state, walkthrough.dismiss ?? "collapse", walkthrough);
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
    case "attached":
      return attach(state, true);
    case "detached":
      return attach(state, false);
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
  if (snapshot.phase !== "running") return noChange(state);

  switch (action) {
    case "reset":
      return { state: enter(walkthrough, 0, state), events: ["reset"] };
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
const newlyGone = (before: Location, after: Location) =>
  after !== before && isGone(after) ? after.status : undefined;

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
    events: NO_EVENTS,
    waymarkGone: newlyGone(snapshot.waymark, waymark),
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
  const { waymarkGone } = seen;
  return due.state.stepGeneration === seen.state.stepGeneration
    ? { ...due, events, waymarkGone, scrollTo: seen.scrollTo }
    : { ...due, events, waymarkGone };
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

function attach<TStep extends Step>(
  state: State<TStep>,
  attached: boolean,
): Outcome<TStep> {
  if (state.attached === attached) return noChange(state);
  const snapshot = state.snapshot;
  // No frames run while detached, so a `state` check cannot be shown to
  // have held throughout and its delay starts again. A click already counts.
  const dropClock =
    !attached &&
    snapshot.phase === "running" &&
    !state.satisfied &&
    checkOf(snapshot.step) !== undefined;
  return {
    state: {
      ...state,
      attached,
      heldSince: dropClock ? undefined : state.heldSince,
      // Nobody looked while detached, so that time does not count towards missing or lost.
      unseenSince: attached ? state.unseenSince : undefined,
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

export const NOTHING_LIVE: LiveWatchers = {
  input: false,
  frame: false,
  waymarkAria: undefined,
  waymarkEvents: undefined,
};

export function needsAdvanceRead(state: State): boolean {
  const snapshot = state.snapshot;
  return (
    state.attached &&
    state.started &&
    snapshot.phase === "running" &&
    !state.unlocked &&
    (checkOf(snapshot.step) !== undefined || state.heldSince !== undefined)
  );
}

export function liveWatchers(state: State): LiveWatchers {
  const snapshot = state.snapshot;
  if (!state.attached || snapshot.phase !== "running" || snapshot.collapsed) return NOTHING_LIVE;
  const step = snapshot.step;
  const conditionUnmet = !state.unlocked;
  const events = eventsOf(step);
  return {
    input: true,
    frame: hasWaymark(step) || needsAdvanceRead(state),
    waymarkAria: state.element === null ? undefined : { element: state.element, expanded: true },
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

/** Where a collapsed walkthrough's beacon can sit: its step's Waymark, measured each frame as an open step's is. */
export type Sighting = Readonly<{
  stepIndex: number;
  waymark: Location;
  unseenSince: number | undefined;
  element: Element | null;
}>;

export const unsighted = (step: Step, stepIndex: number): Sighting => ({
  stepIndex,
  waymark: hasWaymark(step) ? SEARCHING : ABSENT,
  unseenSince: undefined,
  element: null,
});

/** The same Sighting when nothing moved, so the driver sees no change to notify. */
export function sight(previous: Sighting, read: WaymarkRead, now: number, step: Step): Sighting {
  const { waymark, unseenSince } = locate(previous.waymark, previous.unseenSince, read, now, step);
  return waymark === previous.waymark && unseenSince === previous.unseenSince && read.element === previous.element
    ? previous
    : { stepIndex: previous.stepIndex, waymark, unseenSince, element: read.element };
}
