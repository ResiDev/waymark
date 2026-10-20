import { checkOf, delayOf, eventsOf, hasWaymark, isAuto, isClick } from "../walkthrough/walkthrough";
import type { Step, Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { AdvanceRead, Message, Sighting, StepRead, Visit, VisitKey, WaymarkRead } from "../state";
import type { Place } from "./record";
import type { Action, Ended, Location, Rect, RunEventType, Running } from "./types";

export type OnStep = Readonly<{ walkthrough: Walkthrough; entry: WalkthroughProgress; visit: Visit }>;

type MachineEvent = Exclude<RunEventType, "interrupt">;

export type Outcome = Readonly<{
  at: Place;
  visit: Visit | undefined;
  events: readonly MachineEvent[];
  /** Reported once, as the Waymark goes, not on every frame it stays gone. */
  waymarkGone?: "lost" | "missing" | undefined;
  scrollTo?: Element | undefined;
}>;

type Carried = Pick<Visit, "started" | "resumed" | "looked">;

const NO_EVENTS: readonly MachineEvent[] = [];

const ABSENT: Location = { status: "absent" };
const SEARCHING: Location = { status: "searching" };
const WAITING: Location = { status: "waiting" };
const LOST: Location = { status: "lost" };
const MISSING: Location = { status: "missing" };

const isGone = (waymark: Location): waymark is Extract<Location, { status: "lost" | "missing" }> =>
  waymark.status === "lost" || waymark.status === "missing";

export function stepAt<TStep extends Step>(walkthrough: Walkthrough<TStep>, index: number): TStep {
  const step = walkthrough.steps[index];
  if (step === undefined) throw new RangeError(`No step at index ${index}.`);
  return step;
}

const stepOf = (on: OnStep): Step => stepAt(on.walkthrough, on.entry.step);

const still = (on: OnStep, visit = on.visit): Outcome => ({ at: on.entry, visit, events: NO_EVENTS });

export const unsighted = (step: Step, index: number): Sighting => ({
  step: index,
  waymark: hasWaymark(step) ? SEARCHING : ABSENT,
  unseenSince: undefined,
  element: null,
});

export function enter(walkthrough: Walkthrough, step: number, carried: Carried): Visit {
  const shown = stepAt(walkthrough, step);
  return {
    walkthrough: walkthrough.id,
    key: Symbol(),
    started: carried.started,
    resumed: carried.resumed,
    looked: carried.looked,
    satisfied: false,
    unlocked: shown.advance === undefined,
    heldSince: undefined,
    scrolled: false,
    sighting: unsighted(shown, step),
  };
}

/** The gate is open: the condition was met, or the Waymark is lost or missing, so the user is never stuck. */
const canAdvance = (visit: Visit): boolean => visit.unlocked || isGone(visit.sighting.waymark);

export const running = ({ walkthrough, entry, visit }: OnStep): Running => ({
  phase: "running",
  step: stepAt(walkthrough, entry.step),
  stepIndex: entry.step,
  stepCount: walkthrough.steps.length,
  canAdvance: canAdvance(visit),
  collapsed: entry.collapsed,
  waymark: visit.sighting.waymark,
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
  visit: enter(on.walkthrough, step, carried),
  events: [event],
});

function advanceStep(on: OnStep, visit: Visit): Outcome {
  const from = on.entry.step;
  if (from + 1 < on.walkthrough.steps.length) return moveTo(on, from + 1, visit, "advance");
  return {
    at: { status: "finished", step: from, stepCount: on.walkthrough.steps.length, collapsed: false },
    visit: undefined,
    events: ["advance", "finish"],
  };
}

function act(on: OnStep, action: Action): Outcome {
  const { entry, visit } = on;
  switch (action) {
    case "reset":
      return moveTo(on, 0, visit, "reset");
    case "advance":
      return canAdvance(visit) ? advanceStep(on, visit) : still(on);
    case "previous":
      return entry.step === 0 ? still(on) : moveTo(on, entry.step - 1, visit, "previous");
    case "collapse":
      return entry.collapsed ? still(on) : { at: { ...entry, collapsed: true }, visit, events: ["collapse"] };
    case "resume":
      return entry.collapsed ? { at: { ...entry, collapsed: false }, visit, events: ["resume"] } : still(on);
    case "exit":
      return { at: { ...entry, status: "exited", collapsed: false }, visit: undefined, events: ["exit"] };
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

const sighted = (previous: Sighting, waymark: Location, unseenSince: number | undefined, element: Element | null): Sighting =>
  waymark === previous.waymark && unseenSince === previous.unseenSince && element === previous.element
    ? previous
    : { step: previous.step, waymark, unseenSince, element };

/**
 * A Waymark never found is waiting after `WAITING_AFTER`, and missing after its
 * Step's `missingAfterMs`. One found is lost after `LOST_AFTER`, and keeps its
 * last place until then. The same Sighting when nothing moved.
 */
export function sight(previous: Sighting, read: WaymarkRead, now: number, step: Step): Sighting {
  const { element } = read;
  if (!hasWaymark(step)) return sighted(previous, ABSENT, undefined, element);
  if (read.rect !== null) return sighted(previous, foundAt(previous.waymark, read.rect), undefined, element);
  const { waymark } = previous;
  if (waymark.status === "absent" || isGone(waymark)) return sighted(previous, waymark, undefined, element);
  const since = previous.unseenSince ?? now;
  const unseenFor = now - since;
  if (waymark.status === "found") {
    return unseenFor < LOST_AFTER ? sighted(previous, waymark, since, element) : sighted(previous, LOST, undefined, element);
  }
  if (unseenFor >= (step.missingAfterMs ?? MISSING_AFTER)) return sighted(previous, MISSING, undefined, element);
  return sighted(previous, unseenFor < WAITING_AFTER ? waymark : WAITING, since, element);
}

/** Nobody looked while detached, so that time does not count towards missing or lost. */
export const restartUnseen = (sighting: Sighting): Sighting =>
  sighting.unseenSince === undefined ? sighting : { ...sighting, unseenSince: undefined };

function scrollTarget(on: OnStep, visit: Visit, read: WaymarkRead, step: Step): Element | undefined {
  if (!read.element || !read.rect || read.inView || on.entry.collapsed || step.scroll === "never") return undefined;
  return step.scroll === "always" || !visit.scrolled ? read.element : undefined;
}

function whenDue(on: OnStep, visit: Visit, now: number): Outcome {
  const step = stepOf(on);
  if (visit.unlocked || visit.heldSince === undefined || now - visit.heldSince < delayOf(step)) return still(on, visit);
  return isAuto(step) ? advanceStep(on, visit) : still(on, { ...visit, unlocked: true });
}

function observeAdvance(on: OnStep, visit: Visit, read: AdvanceRead, now: number): Outcome {
  if (!visit.started || visit.unlocked) return still(on, visit);
  const holds = visit.satisfied || read.holds;
  const heldSince = holds ? (visit.heldSince ?? now) : undefined;
  return whenDue(on, heldSince === visit.heldSince ? visit : { ...visit, heldSince }, now);
}

// The scroll is dropped if the check moved the walkthrough to another step:
// there is no point scrolling to a Waymark just left.
function observe(on: OnStep, visit: Visit, read: StepRead): Outcome {
  let seen = visit;
  let waymarkGone: Outcome["waymarkGone"];
  let scrollTo: Element | undefined;
  if (read.waymark !== undefined) {
    const step = stepOf(on);
    const sighting = sight(visit.sighting, read.waymark, read.now, step);
    scrollTo = scrollTarget(on, visit, read.waymark, step);
    const scrolled = visit.scrolled || scrollTo !== undefined;
    if (sighting !== visit.sighting || scrolled !== visit.scrolled) seen = { ...visit, sighting, scrolled };
    if (sighting.waymark !== visit.sighting.waymark && isGone(sighting.waymark)) waymarkGone = sighting.waymark.status;
  }
  const due = read.advance === undefined ? still(on, seen) : observeAdvance(on, seen, read.advance, read.now);
  if (waymarkGone === undefined && scrollTo === undefined) return due;
  return { ...due, waymarkGone, scrollTo: due.visit?.key === seen.key ? scrollTo : undefined };
}

function look(on: OnStep, read: StepRead | undefined): Outcome {
  const looked = on.visit.looked ? on.visit : { ...on.visit, looked: true };
  const seen = read === undefined ? still(on, looked) : observe(on, looked, read);
  const { visit } = seen;
  if (visit === undefined || visit.started) return seen;
  return { ...seen, visit: { ...visit, started: true }, events: visit.resumed ? seen.events : [...seen.events, "start"] };
}

function satisfy(on: OnStep, now: number): Outcome {
  const { visit } = on;
  if (!visit.started) return still(on);
  return whenDue(on, visit.satisfied ? visit : { ...visit, satisfied: true, heldSince: visit.heldSince ?? now }, now);
}

// No frames run while detached, so a `state` check cannot be shown to have
// held throughout and its delay starts again. A click already counts.
function detach(on: OnStep): Outcome {
  const { visit } = on;
  const dropClock = !visit.satisfied && checkOf(stepOf(on)) !== undefined;
  const heldSince = dropClock ? undefined : visit.heldSince;
  const sighting = restartUnseen(visit.sighting);
  if (!visit.looked && heldSince === visit.heldSince && sighting === visit.sighting) return still(on);
  return still(on, { ...visit, looked: false, heldSince, sighting });
}

export function apply(on: OnStep, message: Message): Outcome {
  if (message.type === "act") return act(on, message.action);
  if (message.type === "detached") return detach(on);
  if (message.type === "click" && message.hit === "away") return act(on, on.walkthrough.dismiss ?? "collapse");
  if (message.visit !== on.visit.key) return still(on);
  switch (message.type) {
    case "stepRead":
      return observe(on, on.visit, message.read);
    case "look":
      return look(on, message.read);
    case "click":
      return message.hit === "waymark" && isClick(stepOf(on)) ? satisfy(on, message.now) : still(on);
    case "event":
      return eventsOf(stepOf(on)).length > 0 ? satisfy(on, message.now) : still(on);
  }
}

export function needsAdvanceRead(on: OnStep, asLooked = false): boolean {
  const { visit } = on;
  return (
    (visit.looked || asLooked) &&
    visit.started &&
    !visit.unlocked &&
    (checkOf(stepOf(on)) !== undefined || visit.heldSince !== undefined)
  );
}

export type WaymarkAria = Readonly<{ element: Element; expanded: boolean }>;

export type WaymarkEvents = Readonly<{ element: Element; events: readonly string[]; visit: VisitKey }>;

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
  const { visit } = on;
  if (!visit.looked || on.entry.collapsed) return NOTHING_LIVE;
  const step = stepOf(on);
  const { element } = visit.sighting;
  const events = eventsOf(step);
  return {
    input: true,
    frame: hasWaymark(step) || needsAdvanceRead(on),
    waymarkAria: element === null ? undefined : { element, expanded: true },
    waymarkEvents:
      element !== null && !visit.unlocked && events.length > 0 ? { element, events, visit: visit.key } : undefined,
  };
}
