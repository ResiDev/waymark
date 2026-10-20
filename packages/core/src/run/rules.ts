import { checkOf, delayOf, eventsOf, hasWaymark, isAuto, isClick } from "../walkthrough/walkthrough";
import type { Step, Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { AdvanceRead, Message, WaymarkState, StepRead, StepState, ShowingId, WaymarkRead } from "../state";
import type { Place } from "./record";
import type { Action, Ended, Location, Rect, RunEventType, Running } from "./types";

export type OnStep = Readonly<{ walkthrough: Walkthrough; walkthroughProgress: WalkthroughProgress; stepState: StepState }>;

type MachineEvent = Exclude<RunEventType, "interrupt">;

export type Outcome = Readonly<{
  at: Place;
  stepState: StepState | undefined;
  events: readonly MachineEvent[];
  /** Reported once, as the Waymark goes, not on every frame it stays gone. */
  waymarkGone?: "lost" | "missing" | undefined;
  scrollTo?: Element | undefined;
}>;

type Carried = Pick<StepState, "started" | "resumed" | "looked">;

const NO_EVENTS: readonly MachineEvent[] = [];

const ABSENT: Location = { status: "absent" };
const SEARCHING: Location = { status: "searching" };
const WAITING: Location = { status: "waiting" };
const LOST: Location = { status: "lost" };
const MISSING: Location = { status: "missing" };

const isGone = (location: Location): location is Extract<Location, { status: "lost" | "missing" }> =>
  location.status === "lost" || location.status === "missing";

export function stepAt<TStep extends Step>(walkthrough: Walkthrough<TStep>, index: number): TStep {
  const step = walkthrough.steps[index];
  if (step === undefined) throw new RangeError(`No step at index ${index}.`);
  return step;
}

const stepOf = (on: OnStep): Step => stepAt(on.walkthrough, on.walkthroughProgress.step);

const still = (on: OnStep, stepState = on.stepState): Outcome => ({ at: on.walkthroughProgress, stepState, events: NO_EVENTS });

export const unseenWaymark = (step: Step, index: number): WaymarkState => ({
  step: index,
  location: hasWaymark(step) ? SEARCHING : ABSENT,
  unseenSince: undefined,
  element: null,
});

export function enter(walkthrough: Walkthrough, step: number, carried: Carried): StepState {
  const shown = stepAt(walkthrough, step);
  return {
    walkthrough: walkthrough.id,
    showingId: Symbol(),
    started: carried.started,
    resumed: carried.resumed,
    looked: carried.looked,
    satisfied: false,
    unlocked: shown.advance === undefined,
    heldSince: undefined,
    scrolled: false,
    waymark: unseenWaymark(shown, step),
  };
}

/** The gate is open: the condition was met, or the Waymark is lost or missing, so the user is never stuck. */
const canAdvance = (stepState: StepState): boolean => stepState.unlocked || isGone(stepState.waymark.location);

export const running = ({ walkthrough, walkthroughProgress, stepState }: OnStep): Running => ({
  phase: "running",
  step: stepAt(walkthrough, walkthroughProgress.step),
  stepIndex: walkthroughProgress.step,
  stepCount: walkthrough.steps.length,
  canAdvance: canAdvance(stepState),
  collapsed: walkthroughProgress.collapsed,
  waymark: stepState.waymark.location,
});

export const ended = (at: Place): Ended => ({
  phase: at.status === "finished" ? "completed" : "exited",
  stepIndex: at.step,
  stepCount: at.stepCount,
});

const runningAt = (on: OnStep, step: number): Place => ({
  status: "running",
  step,
  stepCount: on.walkthrough.steps.length,
  collapsed: false,
});

const moveTo = (on: OnStep, step: number, carried: Carried, event: MachineEvent): Outcome => ({
  at: runningAt(on, step),
  stepState: enter(on.walkthrough, step, carried),
  events: [event],
});

function advanceStep(on: OnStep, stepState: StepState): Outcome {
  const from = on.walkthroughProgress.step;
  if (from + 1 < on.walkthrough.steps.length) return moveTo(on, from + 1, stepState, "advance");
  return {
    at: { status: "finished", step: from, stepCount: on.walkthrough.steps.length, collapsed: false },
    stepState: undefined,
    events: ["advance", "finish"],
  };
}

function act(on: OnStep, action: Action): Outcome {
  const { walkthroughProgress, stepState } = on;
  switch (action) {
    case "reset":
      return moveTo(on, 0, stepState, "reset");
    case "advance":
      return canAdvance(stepState) ? advanceStep(on, stepState) : still(on);
    case "previous":
      return walkthroughProgress.step === 0 ? still(on) : moveTo(on, walkthroughProgress.step - 1, stepState, "previous");
    case "collapse":
      return walkthroughProgress.collapsed ? still(on) : { at: { ...walkthroughProgress, collapsed: true }, stepState, events: ["collapse"] };
    case "resume":
      return walkthroughProgress.collapsed ? { at: { ...walkthroughProgress, collapsed: false }, stepState, events: ["resume"] } : still(on);
    case "exit":
      return { at: { ...walkthroughProgress, status: "exited", collapsed: false }, stepState: undefined, events: ["exit"] };
  }
}

/** How long, in ms, a Waymark is searched for before its Step shows without it. */
const WAITING_AFTER = 500;

/**
 * How long, in ms, a Waymark may be searched for before it counts as missing,
 * unless its Step says: long enough for a screen to fetch what it shows.
 */
const MISSING_AFTER = 3000;

/** How long, in ms, a found Waymark may be gone before it counts as lost: long enough for a re-render that swaps its element. */
const LOST_AFTER = 200;

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

// The same Location whenever nothing moved: a new one each frame would make a
// new Snapshot, and notify subscribers, every frame.
function foundAt(previous: Location, rect: Rect): Location {
  const unmoved =
    previous.status === "found" &&
    previous.rect.x === rect.x &&
    previous.rect.y === rect.y &&
    previous.rect.width === rect.width &&
    previous.rect.height === rect.height;
  return unmoved ? previous : { status: "found", rect: copyRect(rect) };
}

const waymarkSeen = (previous: WaymarkState, location: Location, unseenSince: number | undefined, element: Element | null): WaymarkState =>
  location === previous.location && unseenSince === previous.unseenSince && element === previous.element
    ? previous
    : { step: previous.step, location, unseenSince, element };

/**
 * A Waymark never found is waiting after `WAITING_AFTER`, and missing after its
 * Step's `missingAfterMs`. One found is lost after `LOST_AFTER`, and keeps its
 * last place until then. The same WaymarkState when nothing moved.
 */
export function seeWaymark(previous: WaymarkState, read: WaymarkRead, now: number, step: Step): WaymarkState {
  const { element } = read;
  if (!hasWaymark(step)) return waymarkSeen(previous, ABSENT, undefined, element);
  if (read.rect !== null) return waymarkSeen(previous, foundAt(previous.location, read.rect), undefined, element);
  const { location } = previous;
  if (location.status === "absent" || isGone(location)) return waymarkSeen(previous, location, undefined, element);
  const since = previous.unseenSince ?? now;
  const unseenFor = now - since;
  if (location.status === "found") {
    return unseenFor < LOST_AFTER ? waymarkSeen(previous, location, since, element) : waymarkSeen(previous, LOST, undefined, element);
  }
  if (unseenFor >= (step.missingAfterMs ?? MISSING_AFTER)) return waymarkSeen(previous, MISSING, undefined, element);
  return waymarkSeen(previous, unseenFor < WAITING_AFTER ? location : WAITING, since, element);
}

/** Nobody looked while detached, so that time does not count towards missing or lost. */
export const restartUnseen = (waymarkState: WaymarkState): WaymarkState =>
  waymarkState.unseenSince === undefined ? waymarkState : { ...waymarkState, unseenSince: undefined };

function scrollTarget(on: OnStep, stepState: StepState, read: WaymarkRead, step: Step): Element | undefined {
  if (!read.element || !read.rect || read.inView || on.walkthroughProgress.collapsed || step.scroll === "never") return undefined;
  return step.scroll === "always" || !stepState.scrolled ? read.element : undefined;
}

function whenDue(on: OnStep, stepState: StepState, now: number): Outcome {
  const step = stepOf(on);
  if (stepState.unlocked || stepState.heldSince === undefined || now - stepState.heldSince < delayOf(step)) return still(on, stepState);
  return isAuto(step) ? advanceStep(on, stepState) : still(on, { ...stepState, unlocked: true });
}

function observeAdvance(on: OnStep, stepState: StepState, read: AdvanceRead, now: number): Outcome {
  if (!stepState.started || stepState.unlocked) return still(on, stepState);
  const holds = stepState.satisfied || read.holds;
  const heldSince = holds ? (stepState.heldSince ?? now) : undefined;
  return whenDue(on, heldSince === stepState.heldSince ? stepState : { ...stepState, heldSince }, now);
}

// The scroll is dropped if the check moved the walkthrough to another step:
// there is no point scrolling to a Waymark just left.
function observe(on: OnStep, stepState: StepState, read: StepRead): Outcome {
  let seen = stepState;
  let waymarkGone: Outcome["waymarkGone"];
  let scrollTo: Element | undefined;
  if (read.waymark !== undefined) {
    const step = stepOf(on);
    const waymarkState = seeWaymark(stepState.waymark, read.waymark, read.now, step);
    scrollTo = scrollTarget(on, stepState, read.waymark, step);
    const scrolled = stepState.scrolled || scrollTo !== undefined;
    if (waymarkState !== stepState.waymark || scrolled !== stepState.scrolled) seen = { ...stepState, waymark: waymarkState, scrolled };
    if (waymarkState.location !== stepState.waymark.location && isGone(waymarkState.location)) waymarkGone = waymarkState.location.status;
  }
  const due = read.advance === undefined ? still(on, seen) : observeAdvance(on, seen, read.advance, read.now);
  if (waymarkGone === undefined && scrollTo === undefined) return due;
  return { ...due, waymarkGone, scrollTo: due.stepState?.showingId === seen.showingId ? scrollTo : undefined };
}

function look(on: OnStep, read: StepRead | undefined): Outcome {
  const looked: StepState = on.stepState.looked ? on.stepState : { ...on.stepState, looked: true };
  const seen = read === undefined ? still(on, looked) : observe(on, looked, read);
  const { stepState } = seen;
  if (stepState === undefined || stepState.started) return seen;
  return { ...seen, stepState: { ...stepState, started: true }, events: stepState.resumed ? seen.events : [...seen.events, "start"] };
}

function satisfy(on: OnStep, now: number): Outcome {
  const { stepState } = on;
  if (!stepState.started) return still(on);
  return whenDue(on, stepState.satisfied ? stepState : { ...stepState, satisfied: true, heldSince: stepState.heldSince ?? now }, now);
}

// No frames run while detached, so a `state` check cannot be shown to have
// held throughout and its delay starts again. A click already counts.
function detach(on: OnStep): Outcome {
  const { stepState } = on;
  const dropClock = !stepState.satisfied && checkOf(stepOf(on)) !== undefined;
  const heldSince = dropClock ? undefined : stepState.heldSince;
  const waymarkState = restartUnseen(stepState.waymark);
  if (!stepState.looked && heldSince === stepState.heldSince && waymarkState === stepState.waymark) return still(on);
  return still(on, { ...stepState, looked: false, heldSince, waymark: waymarkState });
}

export function apply(on: OnStep, message: Message): Outcome {
  if (message.type === "act") return act(on, message.action);
  if (message.type === "detached") return detach(on);
  if (message.type === "click" && message.hit === "away") return act(on, on.walkthrough.dismiss ?? "collapse");
  if (message.showingId !== on.stepState.showingId) return still(on);
  switch (message.type) {
    case "stepRead":
      return observe(on, on.stepState, message.read);
    case "look":
      return look(on, message.read);
    case "click":
      return message.hit === "waymark" && isClick(stepOf(on)) ? satisfy(on, message.now) : still(on);
    case "event":
      return eventsOf(stepOf(on)).length > 0 ? satisfy(on, message.now) : still(on);
  }
}

export function needsAdvanceRead(on: OnStep, asLooked = false): boolean {
  const { stepState } = on;
  return (
    (stepState.looked || asLooked) &&
    stepState.started &&
    !stepState.unlocked &&
    (checkOf(stepOf(on)) !== undefined || stepState.heldSince !== undefined)
  );
}

export type WaymarkAria = Readonly<{ element: Element; expanded: boolean }>;

export type WaymarkEvents = Readonly<{ element: Element; events: readonly string[]; visit: ShowingId }>;

export const sameWaymarkAria = (a: WaymarkAria, b: WaymarkAria): boolean =>
  a.element === b.element && a.expanded === b.expanded;

export const sameWaymarkEvents = (a: WaymarkEvents, b: WaymarkEvents): boolean =>
  a.element === b.element &&
  a.visit === b.visit &&
  a.events.length === b.events.length &&
  a.events.every((event, index) => event === b.events[index]);

type LiveWatchers = Readonly<{
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

export function liveWatchers(on: OnStep): LiveWatchers {
  const { stepState } = on;
  if (!stepState.looked || on.walkthroughProgress.collapsed) return NOTHING_LIVE;
  const step = stepOf(on);
  const { element } = stepState.waymark;
  const events = eventsOf(step);
  return {
    input: true,
    frame: hasWaymark(step) || needsAdvanceRead(on),
    waymarkAria: element === null ? undefined : { element, expanded: true },
    waymarkEvents:
      element !== null && !stepState.unlocked && events.length > 0 ? { element, events, visit: stepState.showingId } : undefined,
  };
}
