import { recordDropped } from "../problems";
import type { StartRequests, Change, RunState, Live, Message, UserRecord, ShownRunState, WaymarkState, StepState, WaymarkRead, Work } from "../state";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { verified, isUnverified, place, put } from "./record";
import { apply, ended, enter, restartUnseen, running, seeWaymark, stepAt, unseenWaymark } from "./rules";
import type { OnStep, Outcome } from "./rules";
import type { Action, Snapshot } from "./types";

export type Candidates = readonly (readonly [Walkthrough, WalkthroughProgress])[];

const NONE: Candidates = [];
const NO_BEACONS: Live["beaconWaymarks"] = new Map();

const withUserRecord = (runState: RunState, userRecord: UserRecord): RunState =>
  userRecord === runState.userRecord ? runState : { ...runState, userRecord };

const withStartRequests = (runState: RunState, startRequests: StartRequests): RunState =>
  startRequests === runState.startRequests ? runState : { ...runState, startRequests };

const withLive = (runState: RunState, live: Live): RunState => (live === runState.live ? runState : { ...runState, live });

const putIn = (runState: RunState, id: string, walkthroughProgress: WalkthroughProgress | undefined): RunState =>
  withUserRecord(runState, put(runState.userRecord, id, walkthroughProgress));

const about = (walkthrough: Walkthrough, index: number, snapshot: Snapshot) => ({
  walkthrough: walkthrough.id,
  step: stepAt(walkthrough, index),
  stepIndex: index,
  snapshot,
});

const counts = (runState: ShownRunState, stepState: StepState): WalkthroughProgress | undefined => {
  const walkthroughProgress = runState.userRecord.walkthroughProgressById[stepState.walkthrough];
  return walkthroughProgress?.status === "running" && !walkthroughProgress.collapsed && walkthroughProgress.step === stepState.waymark.step ? walkthroughProgress : undefined;
};

export function openOf(runState: ShownRunState): OnStep | undefined {
  const { openStep: stepState } = runState.live;
  if (stepState === undefined) return undefined;
  const walkthroughProgress = counts(runState, stepState);
  const walkthrough = runState.walkthroughsAndChecklistsInUse.walkthroughsById.get(stepState.walkthrough);
  return walkthroughProgress === undefined || walkthrough === undefined ? undefined : { walkthrough, walkthroughProgress, stepState };
}

export const openId = (runState: ShownRunState): string | undefined => {
  const { openStep: stepState } = runState.live;
  return stepState !== undefined && counts(runState, stepState) !== undefined ? stepState.walkthrough : undefined;
};

export function beaconCandidates(userRecord: UserRecord, walkthroughs: ReadonlyMap<string, Walkthrough>, opened: string | undefined): Candidates {
  if (opened !== undefined) return NONE;
  const found: (readonly [Walkthrough, WalkthroughProgress])[] = [];
  for (const [id, walkthroughProgress] of Object.entries(userRecord.walkthroughProgressById)) {
    const walkthrough = walkthroughs.get(id);
    if (walkthroughProgress.status === "running" && walkthroughProgress.collapsed && walkthrough !== undefined && !isUnverified(userRecord, id)) {
      found.push([walkthrough, walkthroughProgress]);
    }
  }
  return found.length === 0 ? NONE : found;
}

export const waymarkStateOf = (beaconWaymarks: Live["beaconWaymarks"], walkthrough: Walkthrough, walkthroughProgress: WalkthroughProgress): WaymarkState => {
  const waymarkState = beaconWaymarks.get(walkthrough.id);
  return waymarkState?.step === walkthroughProgress.step ? waymarkState : unseenWaymark(stepAt(walkthrough, walkthroughProgress.step), walkthroughProgress.step);
};

export const wait = (startRequests: StartRequests, id: string): StartRequests =>
  startRequests.waitingToStart.includes(id) ? startRequests : { ...startRequests, waitingToStart: [...startRequests.waitingToStart, id] };

export const unwait = (startRequests: StartRequests, id: string): StartRequests =>
  startRequests.waitingToStart.includes(id) ? { ...startRequests, waitingToStart: startRequests.waitingToStart.filter((waiting) => waiting !== id) } : startRequests;

const snapshotOf = (walkthrough: Walkthrough, at: WalkthroughProgress, stepState: StepState | undefined): Snapshot =>
  stepState !== undefined && at.status === "running" ? running({ walkthrough, walkthroughProgress: at, stepState }) : ended(at);

function follow(runState: RunState, on: OnStep, outcome: Outcome, change: Change, interruptedBy?: string): RunState {
  if (outcome.scrollTo !== undefined) change.scrolls.push(outcome.scrollTo);
  const { walkthrough, walkthroughProgress } = on;
  if (
    outcome.at === walkthroughProgress &&
    outcome.stepState === on.stepState &&
    outcome.events.length === 0 &&
    outcome.waymarkGone === undefined &&
    interruptedBy === undefined
  ) {
    return runState;
  }
  const at = place(walkthroughProgress, outcome.at, change.now);
  const said = about(walkthrough, walkthroughProgress.step, snapshotOf(walkthrough, at, outcome.stepState));
  if (outcome.waymarkGone !== undefined) {
    const type = outcome.waymarkGone === "lost" ? "waymarkLost" : "waymarkMissing";
    change.problems.push({ type, walkthrough: said.walkthrough, step: said.step, stepIndex: said.stepIndex });
  }
  if (interruptedBy !== undefined) change.events.push({ type: "interrupt", ...said, interruptedBy });
  else for (const type of outcome.events) change.events.push({ type, ...said });
  const userRecord = put(runState.userRecord, walkthrough.id, at);
  const live: Live = outcome.stepState === runState.live.openStep ? runState.live : { ...runState.live, openStep: outcome.stepState };
  return userRecord === runState.userRecord && live === runState.live ? runState : { ...runState, userRecord, live };
}

function open(runState: RunState, walkthrough: Walkthrough, change: Change): RunState {
  const { id } = walkthrough;
  const saved = runState.userRecord.walkthroughProgressById[id];
  const resumed = saved?.status === "running";
  const step = resumed ? saved.step : 0;
  const walkthroughProgress = place(saved, { status: "running", step, stepCount: walkthrough.steps.length, collapsed: false }, change.now);
  const stepState = enter(walkthrough, step, { start: resumed ? "resuming" : "pending", looked: false });
  if (resumed && saved.collapsed) change.events.push({ type: "resume", ...about(walkthrough, step, running({ walkthrough, walkthroughProgress, stepState })) });
  return { ...runState, userRecord: put(runState.userRecord, id, walkthroughProgress), live: { ...runState.live, openStep: stepState } };
}

function interrupt(runState: RunState, by: string, change: Change): RunState {
  const on = openOf(runState);
  if (on === undefined) return runState;
  return follow(runState, on, apply(on, { type: "act", action: on.walkthrough.dismiss ?? "collapse" }), change, by);
}

const verifyOne = (runState: RunState, walkthrough: Walkthrough, change: Change): RunState => {
  const { id } = walkthrough;
  const walkthroughProgress = runState.userRecord.walkthroughProgressById[id];
  if (walkthroughProgress === undefined || !isUnverified(runState.userRecord, id)) return runState;
  const at = withUserRecord(runState, verified(runState.userRecord, id));
  const reason = staleness(walkthroughProgress, walkthrough.steps.length, walkthrough.maxAge ?? DEFAULT_MAX_AGE);
  if (reason !== undefined) {
    // Dropped before the handler hears, so a walkthrough it starts keeps its progress.
    change.problems.push(recordDropped(id, reason));
    return putIn(at, id, undefined);
  }
  if (walkthroughProgress.status !== "running" || walkthroughProgress.collapsed) return at;
  if (openId(at) === undefined) return open(at, walkthrough, change);
  const aside = walkthrough.dismiss === "exit" ? { status: "exited" as const } : { collapsed: true };
  return putIn(at, id, { ...walkthroughProgress, ...aside, changedAt: change.now });
};

export const verifyAll: Work = (runState, change) => {
  let next = runState;
  for (const walkthrough of runState.walkthroughsAndChecklistsInUse.walkthroughsById.values()) next = verifyOne(next, walkthrough, change);
  return next;
};

const begin = (runState: RunState, walkthrough: Walkthrough, change: Change): RunState => {
  const { id } = walkthrough;
  const next = withStartRequests(runState, unwait(runState.startRequests, id));
  if (openId(next) === id) return next;
  return open(interrupt(next, id, change), walkthrough, change);
};

export const start =
  (walkthrough: Walkthrough): Work =>
  (runState, change) =>
    begin(verifyOne(runState, walkthrough, change), walkthrough, change);

export const request =
  (walkthrough: Walkthrough): Work =>
  (runState, change) => {
    const next = verifyOne(runState, walkthrough, change);
    return next.userRecord.walkthroughProgressById[walkthrough.id] === undefined ? next : withStartRequests(next, unwait(next.startRequests, walkthrough.id));
  };

export const obey =
  (message: Message): Work =>
  (runState, change) => {
    const on = openOf(runState);
    return on === undefined ? runState : follow(runState, on, apply(on, message), change);
  };

export const reset =
  (walkthrough: Walkthrough): Work =>
  (runState, change) =>
    openId(runState) === walkthrough.id
      ? obey({ type: "act", action: "reset" })(runState, change)
      : putIn(runState, walkthrough.id, undefined);

export const act =
  (action: Action, walkthrough: Walkthrough | undefined): Work =>
  (runState, change) => {
    if (walkthrough === undefined) return obey({ type: "act", action })(runState, change);
    if (action === "reset") return reset(walkthrough)(runState, change);
    const next = verifyOne(runState, walkthrough, change);
    const { id } = walkthrough;
    if (openId(next) === id) return obey({ type: "act", action })(next, change);
    if (action === "resume") return begin(next, walkthrough, change);
    const walkthroughProgress = next.userRecord.walkthroughProgressById[id];
    if (action !== "exit" || walkthroughProgress?.status !== "running") return next;
    const at = place(walkthroughProgress, { ...walkthroughProgress, status: "exited", collapsed: false }, change.now);
    change.events.push({ type: "exit", ...about(walkthrough, walkthroughProgress.step, ended(at)) });
    return putIn(next, id, at);
  };

export const detached: Work = (runState, change) => {
  const next = obey({ type: "detached" })(runState, change);
  let beaconWaymarks: Map<string, WaymarkState> | undefined;
  for (const [id, waymarkState] of next.live.beaconWaymarks) {
    const fresh = restartUnseen(waymarkState);
    if (fresh !== waymarkState) (beaconWaymarks ??= new Map(next.live.beaconWaymarks)).set(id, fresh);
  }
  return beaconWaymarks === undefined ? next : withLive(next, { ...next.live, beaconWaymarks });
};

export const seeBeaconWaymarks =
  (reads: ReadonlyMap<string, WaymarkRead>, now: number): Work =>
  (runState) => {
    let beaconWaymarks: Map<string, WaymarkState> | undefined;
    for (const [id, read] of reads) {
      const walkthroughProgress = runState.userRecord.walkthroughProgressById[id];
      const walkthrough = runState.walkthroughsAndChecklistsInUse.walkthroughsById.get(id);
      if (walkthroughProgress === undefined || walkthrough === undefined) continue;
      const previous = waymarkStateOf(runState.live.beaconWaymarks, walkthrough, walkthroughProgress);
      const next = seeWaymark(previous, read, now, stepAt(walkthrough, walkthroughProgress.step));
      if (next !== previous) (beaconWaymarks ??= new Map(runState.live.beaconWaymarks)).set(id, next);
    }
    return beaconWaymarks === undefined ? runState : withLive(runState, { ...runState.live, beaconWaymarks });
  };

const isBeacon = (runState: RunState, id: string, waymarkState: WaymarkState): boolean => {
  const walkthroughProgress = runState.userRecord.walkthroughProgressById[id];
  return (
    walkthroughProgress?.status === "running" &&
    walkthroughProgress.collapsed &&
    walkthroughProgress.step === waymarkState.step &&
    !isUnverified(runState.userRecord, id)
  );
};

// Its beacon starts where the walkthrough last saw its Waymark.
const dropClosedStepState = (runState: RunState): RunState => {
  const { openStep: stepState, beaconWaymarks } = runState.live;
  if (stepState === undefined || openId(runState) !== undefined) return runState;
  const handed = isBeacon(runState, stepState.walkthrough, stepState.waymark)
    ? new Map(beaconWaymarks).set(stepState.walkthrough, stepState.waymark)
    : beaconWaymarks;
  return withLive(runState, { openStep: undefined, beaconWaymarks: handed });
};

// A request the user has since started, finished or exited is dropped on the
// way. None opens while loading: it would open on an empty record, before a
// start held meanwhile could find it waiting.
const openRequest = (runState: RunState, change: Change): RunState => {
  const { waitingToStart } = runState.startRequests;
  const { walkthroughProgressById, storageStatus: storage } = runState.userRecord;
  if (runState.live.openStep !== undefined || waitingToStart.length === 0 || storage.type === "loading") return runState;
  const at = waitingToStart.findIndex((id) => walkthroughProgressById[id] === undefined);
  const next = withStartRequests(runState, { ...runState.startRequests, waitingToStart: at === -1 ? [] : waitingToStart.slice(at + 1) });
  const walkthrough = at === -1 ? undefined : next.walkthroughsAndChecklistsInUse.walkthroughsById.get(waitingToStart[at] ?? "");
  return walkthrough === undefined ? next : open(next, walkthrough, change);
};

// A beacon's Waymark is looked for afresh each time it shows: it may have moved while another walkthrough was open.
const keepBeacons = (runState: RunState): RunState => {
  const { beaconWaymarks } = runState.live;
  if (beaconWaymarks.size === 0) return runState;
  if (runState.live.openStep !== undefined) return withLive(runState, { ...runState.live, beaconWaymarks: NO_BEACONS });
  let kept: Map<string, WaymarkState> | undefined;
  for (const [id, waymarkState] of beaconWaymarks) {
    if (isBeacon(runState, id, waymarkState)) continue;
    (kept ??= new Map(beaconWaymarks)).delete(id);
  }
  return kept === undefined ? runState : withLive(runState, { ...runState.live, beaconWaymarks: kept });
};

export const settle: Work = (runState, change) => keepBeacons(openRequest(dropClosedStepState(runState), change));
