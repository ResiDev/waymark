import { recordDropped } from "../problems";
import type { Asked, Change, Facts, Live, Message, Recorded, Shown, Sighting, Visit, WaymarkRead, Work } from "../state";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { checked, isUnchecked, place, put } from "./record";
import { apply, ended, enter, restartUnseen, running, sight, stepAt, unsighted } from "./rules";
import type { OnStep, Outcome } from "./rules";
import type { Action, Snapshot } from "./types";

export type Candidates = readonly (readonly [Walkthrough, WalkthroughProgress])[];

const NONE: Candidates = [];
const NO_BEACONS: Live["beacons"] = new Map();

const withRecorded = (facts: Facts, recorded: Recorded): Facts =>
  recorded === facts.recorded ? facts : { ...facts, recorded };

const withAsked = (facts: Facts, asked: Asked): Facts => (asked === facts.asked ? facts : { ...facts, asked });

const withLive = (facts: Facts, live: Live): Facts => (live === facts.live ? facts : { ...facts, live });

const putIn = (facts: Facts, id: string, entry: WalkthroughProgress | undefined): Facts =>
  withRecorded(facts, put(facts.recorded, id, entry));

const about = (walkthrough: Walkthrough, index: number, snapshot: Snapshot) => ({
  walkthrough: walkthrough.id,
  step: stepAt(walkthrough, index),
  stepIndex: index,
  snapshot,
});

const counts = (facts: Shown, visit: Visit): WalkthroughProgress | undefined => {
  const entry = facts.recorded.progress[visit.walkthrough];
  return entry?.status === "running" && !entry.collapsed && entry.step === visit.sighting.step ? entry : undefined;
};

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

export function beaconCandidates(recorded: Recorded, walkthroughs: ReadonlyMap<string, Walkthrough>, opened: string | undefined): Candidates {
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

export const sightingOf = (beacons: Live["beacons"], walkthrough: Walkthrough, entry: WalkthroughProgress): Sighting => {
  const sighting = beacons.get(walkthrough.id);
  return sighting?.step === entry.step ? sighting : unsighted(stepAt(walkthrough, entry.step), entry.step);
};

export const wait = (asked: Asked, id: string): Asked =>
  asked.waiting.includes(id) ? asked : { ...asked, waiting: [...asked.waiting, id] };

export const unwait = (asked: Asked, id: string): Asked =>
  asked.waiting.includes(id) ? { ...asked, waiting: asked.waiting.filter((waiting) => waiting !== id) } : asked;

const snapshotOf = (walkthrough: Walkthrough, at: WalkthroughProgress, visit: Visit | undefined): Snapshot =>
  visit !== undefined && at.status === "running" ? running({ walkthrough, entry: at, visit }) : ended(at);

function follow(facts: Facts, on: OnStep, outcome: Outcome, change: Change, interruptedBy?: string): Facts {
  if (outcome.scrollTo !== undefined) change.scrolls.push(outcome.scrollTo);
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
  const at = place(entry, outcome.at, change.now);
  const said = about(walkthrough, entry.step, snapshotOf(walkthrough, at, outcome.visit));
  if (outcome.waymarkGone !== undefined) {
    const type = outcome.waymarkGone === "lost" ? "waymarkLost" : "waymarkMissing";
    change.problems.push({ type, walkthrough: said.walkthrough, step: said.step, stepIndex: said.stepIndex });
  }
  if (interruptedBy !== undefined) change.events.push({ type: "interrupt", ...said, interruptedBy });
  else for (const type of outcome.events) change.events.push({ type, ...said });
  const recorded = put(facts.recorded, walkthrough.id, at);
  const live = outcome.visit === facts.live.visit ? facts.live : { ...facts.live, visit: outcome.visit };
  return recorded === facts.recorded && live === facts.live ? facts : { ...facts, recorded, live };
}

function open(facts: Facts, walkthrough: Walkthrough, change: Change): Facts {
  const { id } = walkthrough;
  const saved = facts.recorded.progress[id];
  const resumed = saved?.status === "running";
  const step = resumed ? saved.step : 0;
  const entry = place(saved, { status: "running", step, stepCount: walkthrough.steps.length, collapsed: false }, change.now);
  const visit = enter(walkthrough, step, { started: false, resumed, looked: false });
  if (resumed && saved.collapsed) change.events.push({ type: "resume", ...about(walkthrough, step, running({ walkthrough, entry, visit })) });
  return { ...facts, recorded: put(facts.recorded, id, entry), live: { ...facts.live, visit } };
}

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
    change.problems.push(recordDropped(id, reason));
    return putIn(at, id, undefined);
  }
  if (entry.status !== "running" || entry.collapsed) return at;
  if (openId(at) === undefined) return open(at, walkthrough, change);
  const aside = walkthrough.dismiss === "exit" ? { status: "exited" as const } : { collapsed: true };
  return putIn(at, id, { ...entry, ...aside, changedAt: change.now });
};

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

export const start =
  (walkthrough: Walkthrough): Work =>
  (facts, change) =>
    begin(checkOne(facts, walkthrough, change), walkthrough, change);

export const request =
  (walkthrough: Walkthrough): Work =>
  (facts, change) => {
    const next = checkOne(facts, walkthrough, change);
    return next.recorded.progress[walkthrough.id] === undefined ? next : withAsked(next, unwait(next.asked, walkthrough.id));
  };

export const obey =
  (message: Message): Work =>
  (facts, change) => {
    const on = openOf(facts);
    return on === undefined ? facts : follow(facts, on, apply(on, message), change);
  };

export const reset =
  (walkthrough: Walkthrough): Work =>
  (facts, change) =>
    openId(facts) === walkthrough.id
      ? obey({ type: "act", action: "reset" })(facts, change)
      : putIn(facts, walkthrough.id, undefined);

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
    change.events.push({ type: "exit", ...about(walkthrough, entry.step, ended(at)) });
    return putIn(next, id, at);
  };

export const detached: Work = (facts, change) => {
  const next = obey({ type: "detached" })(facts, change);
  let beacons: Map<string, Sighting> | undefined;
  for (const [id, sighting] of next.live.beacons) {
    const fresh = restartUnseen(sighting);
    if (fresh !== sighting) (beacons ??= new Map(next.live.beacons)).set(id, fresh);
  }
  return beacons === undefined ? next : withLive(next, { ...next.live, beacons });
};

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

// Its beacon starts where the walkthrough last saw its Waymark.
const dropClosedVisit = (facts: Facts): Facts => {
  const { visit, beacons } = facts.live;
  if (visit === undefined || openId(facts) !== undefined) return facts;
  const handed = isBeacon(facts, visit.walkthrough, visit.sighting)
    ? new Map(beacons).set(visit.walkthrough, visit.sighting)
    : beacons;
  return withLive(facts, { visit: undefined, beacons: handed });
};

// A request the user has since started, finished or exited is dropped on the
// way. None opens while loading: it would open on an empty record, before a
// start held meanwhile could find it waiting.
const openRequest = (facts: Facts, change: Change): Facts => {
  const { waiting } = facts.asked;
  const { progress, storage } = facts.recorded;
  if (facts.live.visit !== undefined || waiting.length === 0 || storage.type === "loading") return facts;
  const at = waiting.findIndex((id) => progress[id] === undefined);
  const next = withAsked(facts, { ...facts.asked, waiting: at === -1 ? [] : waiting.slice(at + 1) });
  const walkthrough = at === -1 ? undefined : next.given.walkthroughs.get(waiting[at] ?? "");
  return walkthrough === undefined ? next : open(next, walkthrough, change);
};

// A beacon's Waymark is looked for afresh each time it shows: it may have moved while another walkthrough was open.
const keepBeacons = (facts: Facts): Facts => {
  const { beacons } = facts.live;
  if (beacons.size === 0) return facts;
  if (facts.live.visit !== undefined) return withLive(facts, { ...facts.live, beacons: NO_BEACONS });
  let kept: Map<string, Sighting> | undefined;
  for (const [id, sighting] of beacons) {
    if (isBeacon(facts, id, sighting)) continue;
    (kept ??= new Map(beacons)).delete(id);
  }
  return kept === undefined ? facts : withLive(facts, { ...facts.live, beacons: kept });
};

export const settle: Work = (facts, change) => keepBeacons(openRequest(dropClosedVisit(facts), change));
