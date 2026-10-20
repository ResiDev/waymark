import { recordDropped } from "../problems";
import type { Asked, Change, Facts, Live, Message, Recorded, Shown, Sighting, Visit, WaymarkRead, Work } from "../state";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { checked, isUnchecked, place, put } from "./record";
import { apply, ended, enter, running, sight, stepAt, unseen, unsighted } from "./rules";
import type { OnStep, Outcome } from "./rules";
import type { Action, Snapshot } from "./types";

export type Collapsed = readonly (readonly [Walkthrough, WalkthroughProgress])[];

const NONE: Collapsed = [];
const NO_BEACONS: Live["beacons"] = new Map();

const withRecorded = (facts: Facts, recorded: Recorded): Facts =>
  recorded === facts.recorded ? facts : { ...facts, recorded };

const withAsked = (facts: Facts, asked: Asked): Facts => (asked === facts.asked ? facts : { ...facts, asked });

const withLive = (facts: Facts, live: Live): Facts => (live === facts.live ? facts : { ...facts, live });

/** A visit counts while its walkthrough's entry is running, not collapsed and at the visit's step. */
const counts = (facts: Shown, visit: Visit): WalkthroughProgress | undefined => {
  const entry = facts.recorded.progress[visit.walkthrough];
  return entry?.status === "running" && !entry.collapsed && entry.step === visit.sighting.step ? entry : undefined;
};

/** The open walkthrough: the visit's, while it counts. */
export function openOf(facts: Shown): OnStep | undefined {
  const { visit } = facts.live;
  if (visit === undefined) return undefined;
  const entry = counts(facts, visit);
  const walkthrough = facts.given.walkthroughs.get(visit.walkthrough);
  return entry === undefined || walkthrough === undefined ? undefined : { walkthrough, entry, visit };
}

export const openId = (facts: Shown): string | undefined => {
  const { visit } = facts.live;
  return visit !== undefined && counts(facts, visit) !== undefined ? visit.walkthrough : undefined;
};

/** The walkthroughs the Run draws as beacons: collapsed, running, checked and defined, and none while one is open. */
export function collapsed(recorded: Recorded, walkthroughs: ReadonlyMap<string, Walkthrough>, opened: string | undefined): Collapsed {
  if (opened !== undefined) return NONE;
  const found: (readonly [Walkthrough, WalkthroughProgress])[] = [];
  for (const [id, entry] of Object.entries(recorded.progress)) {
    const walkthrough = walkthroughs.get(id);
    if (entry.status === "running" && entry.collapsed && walkthrough !== undefined && !isUnchecked(recorded, id)) {
      found.push([walkthrough, entry]);
    }
  }
  return found.length === 0 ? NONE : found;
}

/** Where a beacon's Waymark was last seen: its sighting when it is for the step the walkthrough is on, else not looked for yet. */
export const sightingOf = (beacons: Live["beacons"], walkthrough: Walkthrough, entry: WalkthroughProgress): Sighting => {
  const sighting = beacons.get(walkthrough.id);
  return sighting?.step === entry.step ? sighting : unsighted(stepAt(walkthrough, entry.step), entry.step);
};

/** A request joins the waiting list at the call, even while the record loads, so a start held meanwhile finds it waiting. */
export const wait = (asked: Asked, id: string): Asked =>
  asked.waiting.includes(id) ? asked : { ...asked, waiting: [...asked.waiting, id] };

export const unwait = (asked: Asked, id: string): Asked =>
  asked.waiting.includes(id) ? { ...asked, waiting: asked.waiting.filter((waiting) => waiting !== id) } : asked;

const snapshotOf = (walkthrough: Walkthrough, at: WalkthroughProgress, visit: Visit | undefined): Snapshot =>
  visit !== undefined && at.status === "running" ? running({ walkthrough, entry: at, visit }) : ended(at);

/**
 * What a message did to the walkthrough on `on`: its entry placed, its visit
 * replaced, and what it said told, each event with the snapshot it left. An
 * interruption says only `interrupt`.
 */
function follow(facts: Facts, on: OnStep, outcome: Outcome, change: Change, interruptedBy?: string): Facts {
  if (outcome.scrollTo !== undefined) change.scrollTo(outcome.scrollTo);
  const { walkthrough, entry } = on;
  if (
    outcome.at === entry &&
    outcome.visit === on.visit &&
    outcome.events.length === 0 &&
    outcome.waymarkGone === undefined &&
    interruptedBy === undefined
  ) {
    return facts;
  }
  const { id } = walkthrough;
  const at = place(entry, outcome.at, change.now);
  const step = stepAt(walkthrough, entry.step);
  if (outcome.waymarkGone !== undefined) {
    const type = outcome.waymarkGone === "lost" ? "waymarkLost" : "waymarkMissing";
    change.problem({ type, walkthrough: id, step, stepIndex: entry.step });
  }
  const snapshot = snapshotOf(walkthrough, at, outcome.visit);
  if (interruptedBy !== undefined) {
    change.event({ type: "interrupt", walkthrough: id, step, stepIndex: entry.step, snapshot, interruptedBy });
  } else {
    for (const type of outcome.events) change.event({ type, walkthrough: id, step, stepIndex: entry.step, snapshot });
  }
  const recorded = put(facts.recorded, id, at);
  const live = outcome.visit === facts.live.visit ? facts.live : { ...facts.live, visit: outcome.visit };
  return recorded === facts.recorded && live === facts.live ? facts : { ...facts, recorded, live };
}

/**
 * The one way a walkthrough opens: its entry and its visit, together. Where
 * it opens and whether it says `start` follow from its entry: part way
 * through, it opens where it was and never says `start`, and says `resume`
 * if it was collapsed; otherwise it opens fresh at step 1.
 */
function open(facts: Facts, walkthrough: Walkthrough, change: Change): Facts {
  const { id } = walkthrough;
  const saved = facts.recorded.progress[id];
  const resumed = saved?.status === "running";
  const step = resumed ? saved.step : 0;
  const entry = place(saved, { status: "running", step, stepCount: walkthrough.steps.length, collapsed: false }, change.now);
  const visit = enter(walkthrough, step, { started: false, resumed, looked: false });
  if (resumed && saved.collapsed) {
    const snapshot = running({ walkthrough, entry, visit });
    change.event({ type: "resume", walkthrough: id, step: stepAt(walkthrough, step), stepIndex: step, snapshot });
  }
  return { ...facts, recorded: put(facts.recorded, id, entry), live: { ...facts.live, visit } };
}

/** The open walkthrough set aside as its `dismiss` says, for the one started over it. */
function interrupt(facts: Facts, by: string, change: Change): Facts {
  const on = openOf(facts);
  if (on === undefined) return facts;
  return follow(facts, on, apply(on, { type: "act", action: on.walkthrough.dismiss ?? "collapse" }), change, by);
}

const checkOne = (facts: Facts, walkthrough: Walkthrough, change: Change): Facts => {
  const { id } = walkthrough;
  const entry = facts.recorded.progress[id];
  if (entry === undefined || !isUnchecked(facts.recorded, id)) return facts;
  const at = withRecorded(facts, checked(facts.recorded, id));
  const reason = staleness(entry, walkthrough.steps.length, walkthrough.maxAge ?? DEFAULT_MAX_AGE);
  if (reason !== undefined) {
    // Dropped before the handler hears, so a walkthrough it starts keeps its progress.
    change.problem(recordDropped(id, reason));
    return withRecorded(at, put(at.recorded, id, undefined));
  }
  if (entry.status !== "running" || entry.collapsed) return at;
  if (openId(at) === undefined) return open(at, walkthrough, change);
  const aside = walkthrough.dismiss === "exit" ? { status: "exited" as const } : { collapsed: true };
  return withRecorded(at, put(at.recorded, id, { ...entry, ...aside, changedAt: change.now }));
};

/**
 * A restored entry meets its definition: dropped if it cannot be picked up
 * again; if it was open, opened again, or set aside as its `dismiss` says
 * when another is open. Every command on a walkthrough does this first.
 */
export const check =
  (walkthrough: Walkthrough): Work =>
  (facts, change) =>
    checkOne(facts, walkthrough, change);

/** Every unchecked entry whose definition has come, in the order the definitions came. */
export const checkAll: Work = (facts, change) => {
  let next = facts;
  for (const walkthrough of facts.given.walkthroughs.values()) next = checkOne(next, walkthrough, change);
  return next;
};

const begin = (facts: Facts, walkthrough: Walkthrough, change: Change): Facts => {
  const { id } = walkthrough;
  const next = withAsked(facts, unwait(facts.asked, id));
  if (openId(next) === id) return next;
  return open(interrupt(next, id, change), walkthrough, change);
};

/** `run.start`: opened as its entry says, after the open one is set aside. Nothing when it is open. */
export const start =
  (walkthrough: Walkthrough): Work =>
  (facts, change) =>
    begin(checkOne(facts, walkthrough, change), walkthrough, change);

/** `run.requestStart`'s change: used up once its walkthrough is found started. `settle` opens it once nothing is open. */
export const request =
  (walkthrough: Walkthrough): Work =>
  (facts, change) => {
    const next = checkOne(facts, walkthrough, change);
    return next.recorded.progress[walkthrough.id] === undefined ? next : withAsked(next, unwait(next.asked, walkthrough.id));
  };

/** A message from the page, or an action, on the open step. Nothing when nothing is open. */
export const obey =
  (message: Message): Work =>
  (facts, change) => {
    const on = openOf(facts);
    return on === undefined ? facts : follow(facts, on, apply(on, message), change);
  };

/** `run.reset`: the open one back to step 1; any other forgotten, checked or not. */
export const reset =
  (walkthrough: Walkthrough): Work =>
  (facts, change) =>
    openId(facts) === walkthrough.id
      ? obey({ type: "act", action: "reset" })(facts, change)
      : withRecorded(facts, put(facts.recorded, walkthrough.id, undefined));

/**
 * `run.act` on `walkthrough`, or on whatever is open when the work runs. On
 * the open one, the rules act; on another, `resume` starts it and `exit` ends
 * it where its entry is.
 */
export const act =
  (action: Action, walkthrough: Walkthrough | undefined): Work =>
  (facts, change) => {
    if (walkthrough === undefined) return obey({ type: "act", action })(facts, change);
    if (action === "reset") return reset(walkthrough)(facts, change);
    const next = checkOne(facts, walkthrough, change);
    const { id } = walkthrough;
    if (openId(next) === id) return obey({ type: "act", action })(next, change);
    if (action === "resume") return begin(next, walkthrough, change);
    const entry = next.recorded.progress[id];
    if (action !== "exit" || entry?.status !== "running") return next;
    const at = place(entry, { ...entry, status: "exited", collapsed: false }, change.now);
    change.event({ type: "exit", walkthrough: id, step: stepAt(walkthrough, entry.step), stepIndex: entry.step, snapshot: ended(at) });
    return withRecorded(next, put(next.recorded, id, at));
  };

/** The Run detached: the open step stops being looked at, and each beacon's time unseen starts again, as nobody watched. */
export const detached: Work = (facts, change) => {
  const next = obey({ type: "detached" })(facts, change);
  let beacons: Map<string, Sighting> | undefined;
  for (const [id, sighting] of next.live.beacons) {
    const fresh = unseen(sighting);
    if (fresh !== sighting) (beacons ??= new Map(next.live.beacons)).set(id, fresh);
  }
  return beacons === undefined ? next : withLive(next, { ...next.live, beacons });
};

/** A frame with nothing open: each beacon sighted from what the page measured, by walkthrough id. */
export const sightBeacons =
  (reads: ReadonlyMap<string, WaymarkRead>, now: number): Work =>
  (facts) => {
    let beacons: Map<string, Sighting> | undefined;
    for (const [id, read] of reads) {
      const entry = facts.recorded.progress[id];
      const walkthrough = facts.given.walkthroughs.get(id);
      if (entry === undefined || walkthrough === undefined) continue;
      const previous = sightingOf(facts.live.beacons, walkthrough, entry);
      const next = sight(previous, read, now, stepAt(walkthrough, entry.step));
      if (next !== previous) (beacons ??= new Map(facts.live.beacons)).set(id, next);
    }
    return beacons === undefined ? facts : withLive(facts, { ...facts.live, beacons });
  };

const isBeacon = (facts: Facts, id: string, sighting: Sighting): boolean => {
  const entry = facts.recorded.progress[id];
  return (
    entry?.status === "running" && entry.collapsed && entry.step === sighting.step && !isUnchecked(facts.recorded, id)
  );
};

/**
 * Once, after every work of a change:
 *
 * 1. A visit that does not count is dropped. If its walkthrough collapsed,
 *    its sighting goes to the beacon, which starts where the step last saw
 *    its Waymark.
 * 2. With nothing open and the record in, the first request without progress
 *    opens, and every request before it, found started since, is dropped.
 * 3. Beacons are kept only while none is open, and only for the step each is
 *    on, so each is looked for afresh when it shows again.
 */
export const settle: Work = (facts, change) => {
  let next = facts;
  const { visit } = next.live;
  if (visit !== undefined && openId(next) === undefined) {
    const { beacons } = next.live;
    const handed = isBeacon(next, visit.walkthrough, visit.sighting)
      ? new Map(beacons).set(visit.walkthrough, visit.sighting)
      : beacons;
    next = withLive(next, { visit: undefined, beacons: handed });
  }

  const { waiting } = next.asked;
  if (next.live.visit === undefined && waiting.length > 0 && next.recorded.storage.type !== "loading") {
    const at = waiting.findIndex((id) => next.recorded.progress[id] === undefined);
    next = withAsked(next, { ...next.asked, waiting: at === -1 ? [] : waiting.slice(at + 1) });
    const walkthrough = at === -1 ? undefined : next.given.walkthroughs.get(waiting[at] ?? "");
    if (walkthrough !== undefined) next = open(next, walkthrough, change);
  }

  const { beacons } = next.live;
  if (beacons.size === 0) return next;
  if (next.live.visit !== undefined) return withLive(next, { ...next.live, beacons: NO_BEACONS });
  let kept: Map<string, Sighting> | undefined;
  for (const [id, sighting] of beacons) {
    if (isBeacon(next, id, sighting)) continue;
    (kept ??= new Map(beacons)).delete(id);
  }
  return kept === undefined ? next : withLive(next, { ...next.live, beacons: kept });
};
