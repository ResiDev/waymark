import { statusIn } from "../checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import type { Candidates, Given, Live, RunViews, ShownRunState, Views } from "../state";
import type { Walkthrough } from "../walkthrough/types";
import { running, stepAt, type OnStep } from "./rules";
import { taskIdFor } from "./tasks";
import type { Beacon, OpenWalkthrough, Running, RunSnapshot } from "./types";
import { beaconCandidates, openId, openOf, waymarkStateOf } from "./walkthroughs";

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

const sameCandidates = (a: Candidates, b: Candidates): boolean =>
  a.length === b.length &&
  a.every(([walkthrough, walkthroughProgress], index) => {
    const other = b[index];
    return other !== undefined && walkthrough === other[0] && walkthroughProgress === other[1];
  });

const sameRunSnapshot = (a: RunSnapshot, b: RunSnapshot): boolean =>
  a.storageStatus === b.storageStatus && a.progress === b.progress && a.open === b.open && a.beacons === b.beacons;

function openView(on: OnStep | undefined, groups: readonly ChecklistGroup[], last: OpenWalkthrough | null | undefined): OpenWalkthrough | null {
  if (on === undefined) return null;
  const { walkthrough } = on;
  const made = running(on);
  const snapshot = last?.walkthrough === walkthrough && sameRunning(last.snapshot, made) ? last.snapshot : made;
  const task = taskIdFor(groups, walkthrough.id);
  return last?.snapshot === snapshot && last.task === task ? last : { walkthrough, snapshot, task };
}

function beaconsView(candidates: Candidates, beaconWaymarks: Live["beaconWaymarks"], last: readonly Beacon[] | undefined): readonly Beacon[] {
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

/**
 * The Run's snapshot and the views it is made of. Kept whole while it reads
 * the same objects; otherwise each is worked out again, and kept as last
 * change's object if it shows the same.
 */
export function viewRun(last: RunViews | undefined, runState: ShownRunState): RunViews {
  const { walkthroughsAndChecklistsInUse, userRecord, live } = runState;
  if (last?.from[0] === walkthroughsAndChecklistsInUse && last.from[1] === userRecord && last.from[2] === live) return last;
  const found = beaconCandidates(userRecord, walkthroughsAndChecklistsInUse.walkthroughsById, openId(runState));
  const candidates = last !== undefined && sameCandidates(last.candidates, found) ? last.candidates : found;
  const open = openView(openOf(runState), walkthroughsAndChecklistsInUse.checklistDefinitions, last?.open);
  const beacons = beaconsView(candidates, live.beaconWaymarks, last?.beacons);
  const made: RunSnapshot = { storageStatus: userRecord.storageStatus.type, progress: userRecord.walkthroughProgressById, open, beacons };
  const snapshot = last !== undefined && sameRunSnapshot(last.snapshot, made) ? last.snapshot : made;
  return { from: [walkthroughsAndChecklistsInUse, userRecord, live], candidates, open, beacons, snapshot };
}

type Snapshot = ChecklistSnapshot<AnyTask>;

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.open === b.open &&
  a.storageStatus === b.storageStatus &&
  a.tasks.every((row, index) => row.status === b.tasks[index]?.status && row.walkthrough === b.tasks[index].walkthrough);

/** What a checklist shows, as `last` if that shows the same. */
export function viewChecklist(definition: ChecklistDefinition<AnyTask>, group: ChecklistGroup, last: Snapshot | undefined, runState: ShownRunState): Snapshot {
  const { taskStatusById, walkthroughProgressById, storageStatus } = runState.userRecord;
  const opened = openId(runState);
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
    storageStatus: storageStatus.type,
  };
  return last !== undefined && sameSnapshot(last, next) ? last : next;
}

/** What a checklist shows now: worked out in a change, or as first asked for. */
export const checklistNow = (views: Views, given: Given, definition: ChecklistDefinition<AnyTask>): Snapshot | undefined =>
  views.checklists.get(definition) ?? given.checklistsAsked.get(definition)?.first;

/** Every view, after a change. A checklist that showed nothing new keeps its object. */
export function viewAll(views: Views, given: Given, runState: ShownRunState): Views {
  const run = viewRun(views.run, runState);
  let checklists: Map<ChecklistDefinition<AnyTask>, Snapshot> | undefined;
  for (const [definition, { group, first }] of given.checklistsAsked) {
    const last = views.checklists.get(definition);
    const shown = viewChecklist(definition, group, last ?? first, runState);
    if (shown !== last) (checklists ??= new Map(views.checklists)).set(definition, shown);
  }
  return run === views.run && checklists === undefined ? views : { run, checklists: checklists ?? views.checklists };
}
