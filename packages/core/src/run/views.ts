import { statusIn } from "../checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import type { Candidates, ChecklistShown, Given, Live, RunViews, Shown, ShownRunState, Views } from "../state";
import type { Walkthrough } from "../walkthrough/types";
import { running, stepAt } from "./rules";
import { taskIdFor } from "./tasks";
import type { Beacon, OpenWalkthrough, Running, RunSnapshot } from "./types";
import { beaconCandidates, openId, openOf, waymarkStateOf } from "./walkthroughs";

const sameParts = (a: readonly unknown[], b: readonly unknown[]): boolean => {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
};

/** `last` while `from` is the same, part by part. `compute` gets the last value, so it can hand it back when nothing shown moved. */
function reuse<T, TFrom extends readonly unknown[]>(
  last: Shown<T, TFrom> | undefined,
  from: TFrom,
  compute: (from: TFrom, last: T | undefined) => T,
): Shown<T, TFrom> {
  return last !== undefined && sameParts(from, last.from) ? last : { value: compute(from, last?.value), from };
}

const NO_BEACONS: readonly Beacon[] = Object.freeze([]);

const sameRunning = (a: Running, b: Running): boolean =>
  a.step === b.step &&
  a.stepIndex === b.stepIndex &&
  a.stepCount === b.stepCount &&
  a.canAdvance === b.canAdvance &&
  a.collapsed === b.collapsed &&
  a.waymark === b.waymark;

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

function openShown(
  [walkthrough, walkthroughProgress, stepState, groups]: RunViews["open"]["from"],
  last: OpenWalkthrough | null | undefined,
): OpenWalkthrough | null {
  if (walkthrough === undefined || walkthroughProgress === undefined || stepState === undefined) return null;
  const made = running({ walkthrough, walkthroughProgress, stepState });
  const snapshot = last?.walkthrough === walkthrough && sameRunning(last.snapshot, made) ? last.snapshot : made;
  const task = taskIdFor(groups, walkthrough.id);
  return last?.snapshot === snapshot && last.task === task ? last : { walkthrough, snapshot, task };
}

function beaconsShown([candidates, beaconWaymarks]: readonly [Candidates, Live["beaconWaymarks"]], last: readonly Beacon[] | undefined): readonly Beacon[] {
  let latest: Walkthrough | undefined;
  let latestAt = -Infinity;
  for (const [walkthrough, walkthroughProgress] of candidates) {
    if (walkthroughProgress.changedAt >= latestAt) {
      latest = walkthrough;
      latestAt = walkthroughProgress.changedAt;
    }
  }
  const shown: Beacon[] = [];
  for (const [walkthrough, walkthroughProgress] of candidates) {
    const { location } = waymarkStateOf(beaconWaymarks, walkthrough, walkthroughProgress);
    const anywhere = location.status === "absent" || location.status === "lost" || location.status === "missing";
    if (location.status !== "found" && !(anywhere && walkthrough === latest)) continue;
    const was = last?.find((beacon) => beacon.walkthrough === walkthrough);
    shown.push(
      was?.stepIndex === walkthroughProgress.step && was.waymark === location
        ? was
        : { walkthrough, step: stepAt(walkthrough, walkthroughProgress.step), stepIndex: walkthroughProgress.step, waymark: location },
    );
  }
  if (shown.length === 0) return NO_BEACONS;
  return last !== undefined && sameList(shown, last) ? last : shown;
}

const runSnapshot = ([storageStatus, progress, open, beacons]: RunViews["snapshot"]["from"]): RunSnapshot => ({
  storageStatus,
  progress,
  open,
  beacons,
});

/** The Run's snapshot and the views it is made of, each worked out again only if what it reads moved. */
export function viewRun(last: RunViews | undefined, runState: ShownRunState): RunViews {
  const { walkthroughsAndChecklistsInUse, userRecord, live } = runState;
  if (last?.from[0] === walkthroughsAndChecklistsInUse && last.from[1] === userRecord && last.from[2] === live) return last;
  const on = openOf(runState);
  const candidates = reuse(last?.candidates, [userRecord, walkthroughsAndChecklistsInUse.walkthroughsById, openId(runState)] as const, (from) =>
    beaconCandidates(...from),
  );
  const open = reuse(
    last?.open,
    [on?.walkthrough, on?.walkthroughProgress, on?.stepState, walkthroughsAndChecklistsInUse.checklistDefinitions] as const,
    openShown,
  );
  const beacons = reuse(last?.beacons, [candidates.value, live.beaconWaymarks] as const, beaconsShown);
  const snapshot = reuse(last?.snapshot, [userRecord.storageStatus.type, userRecord.walkthroughProgressById, open.value, beacons.value] as const, runSnapshot);
  return { from: [walkthroughsAndChecklistsInUse, userRecord, live], candidates, open, beacons, snapshot };
}

type Snapshot = ChecklistSnapshot<AnyTask>;

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.open === b.open &&
  a.storageStatus === b.storageStatus &&
  a.tasks.every((row, index) => row.status === b.tasks[index]?.status && row.walkthrough === b.tasks[index].walkthrough);

function checklistSnapshot(
  definition: ChecklistDefinition<AnyTask>,
  group: ChecklistGroup,
  [taskStatusById, walkthroughProgressById, storage, opened]: ChecklistShown["from"],
  last: Snapshot | undefined,
): Snapshot {
  const walkthroughOf = new Map(group.tasks.map((task) => [task.id, task.walkthrough?.id]));
  const tasks = definition.tasks.map((task) => {
    const id = walkthroughOf.get(task.id);
    const walkthroughProgress = id === undefined ? undefined : walkthroughProgressById[id];
    const collapsed = walkthroughProgress?.status === "running" && walkthroughProgress.collapsed;
    return { task, status: statusIn(taskStatusById, task.id), walkthrough: id !== undefined && id === opened ? "open" : collapsed ? "collapsed" : "none" } as const;
  });
  const finishedCount = tasks.filter((row) => row.status !== "todo").length;
  const next: Snapshot = {
    tasks,
    finishedCount,
    taskCount: tasks.length,
    complete: finishedCount === tasks.length,
    open: opened === undefined ? null : (definition.tasks.find((task) => walkthroughOf.get(task.id) === opened) ?? null),
    storageStatus: storage.type,
  };
  return last !== undefined && sameSnapshot(last, next) ? last : next;
}

export function viewChecklist(
  definition: ChecklistDefinition<AnyTask>,
  group: ChecklistGroup,
  last: ChecklistShown | undefined,
  runState: ShownRunState,
): ChecklistShown {
  const { taskStatusById, walkthroughProgressById, storageStatus } = runState.userRecord;
  return reuse(last, [taskStatusById, walkthroughProgressById, storageStatus, openId(runState)] as const, (from, lastSnapshot) =>
    checklistSnapshot(definition, group, from, lastSnapshot),
  );
}

/** What a checklist shows now: worked out in a change, or as first asked for. */
export const checklistNow = (views: Views, given: Given, definition: ChecklistDefinition<AnyTask>): ChecklistShown | undefined =>
  views.checklists.get(definition) ?? given.checklistsAsked.get(definition)?.first;

/** Every view, after a change. A checklist that showed nothing new keeps its object. */
export function viewAll(views: Views, given: Given, runState: ShownRunState): Views {
  const run = viewRun(views.run, runState);
  let checklists: Map<ChecklistDefinition<AnyTask>, ChecklistShown> | undefined;
  for (const [definition, { group, first }] of given.checklistsAsked) {
    const last = views.checklists.get(definition);
    const shown = viewChecklist(definition, group, last ?? first, runState);
    if (shown !== last) (checklists ??= new Map(views.checklists)).set(definition, shown);
  }
  return run === views.run && checklists === undefined ? views : { run, checklists: checklists ?? views.checklists };
}
