import { statusIn } from "../checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import type { WalkthroughsAndChecklistsInUse, Live, UserRecord, ShownRunState, StepState } from "../state";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { memo } from "./memo";
import { running, stepAt } from "./rules";
import { taskIdFor } from "./tasks";
import type { Beacon, OpenWalkthrough, Running, RunSnapshot } from "./types";
import { beaconCandidates, openId, openOf, waymarkStateOf } from "./walkthroughs";
import type { Candidates } from "./walkthroughs";

export type View<T> = Readonly<{
  update: (runState: ShownRunState) => T;
  current: () => T;
}>;

function viewOf<T>(of: (runState: ShownRunState) => T, runState: ShownRunState): View<T> {
  let shown = of(runState);
  return {
    update: (next) => (shown = of(next)),
    current: () => shown,
  };
}

export function candidatesOf(): (runState: ShownRunState) => Candidates {
  const of = memo(([userRecord, walkthroughs, opened]: readonly [UserRecord, WalkthroughsAndChecklistsInUse["walkthroughsById"], string | undefined]) =>
    beaconCandidates(userRecord, walkthroughs, opened),
  );
  return (runState) => of(runState.userRecord, runState.walkthroughsAndChecklistsInUse.walkthroughsById, openId(runState));
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

type OpenArgs = readonly [Walkthrough | undefined, WalkthroughProgress | undefined, StepState | undefined, readonly ChecklistGroup[]];

function openShown([walkthrough, walkthroughProgress, stepState, groups]: OpenArgs, last: OpenWalkthrough | null | undefined): OpenWalkthrough | null {
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

export function runView(candidatesNow: (runState: ShownRunState) => Candidates, runState: ShownRunState): View<RunSnapshot> {
  const open = memo(openShown);
  const beacons = memo(beaconsShown);
  const snapshot = memo(
    ([status, walkthroughProgressById, opened, shown]: readonly [
      RunSnapshot["storageStatus"],
      UserRecord["walkthroughProgressById"],
      OpenWalkthrough | null,
      readonly Beacon[],
    ]): RunSnapshot => ({
      storageStatus: status,
      progress: walkthroughProgressById,
      open: opened,
      beacons: shown,
    }),
  );
  const of = memo(([walkthroughsAndChecklistsInUse, userRecord, live]: readonly [WalkthroughsAndChecklistsInUse, UserRecord, Live]) => {
    const shown = { walkthroughsAndChecklistsInUse, userRecord, live };
    const on = openOf(shown);
    return snapshot(
      userRecord.storageStatus.type,
      userRecord.walkthroughProgressById,
      open(on?.walkthrough, on?.walkthroughProgress, on?.stepState, walkthroughsAndChecklistsInUse.checklistDefinitions),
      beacons(candidatesNow(shown), live.beaconWaymarks),
    );
  });
  return viewOf((shown) => of(shown.walkthroughsAndChecklistsInUse, shown.userRecord, shown.live), runState);
}

type Snapshot = ChecklistSnapshot<AnyTask>;

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.open === b.open &&
  a.storageStatus === b.storageStatus &&
  a.tasks.every((row, index) => row.status === b.tasks[index]?.status && row.inProgress === b.tasks[index].inProgress);

export function checklistView(definition: ChecklistDefinition<AnyTask>, group: ChecklistGroup, runState: ShownRunState): View<Snapshot> {
  const walkthroughOf = new Map(group.tasks.map((task) => [task.id, task.walkthrough?.id]));
  type Args = readonly [UserRecord["taskStatusById"], UserRecord["walkthroughProgressById"], UserRecord["storageStatus"], string | undefined];
  const of = memo(([taskStatusById, walkthroughProgressById, storage, opened]: Args, last: Snapshot | undefined): Snapshot => {
    const tasks = definition.tasks.map((task) => {
      const walkthrough = walkthroughOf.get(task.id);
      const walkthroughProgress = walkthrough === undefined ? undefined : walkthroughProgressById[walkthrough];
      return { task, status: statusIn(taskStatusById, task.id), inProgress: walkthroughProgress?.status === "running" && walkthroughProgress.collapsed };
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
  });
  return viewOf((shown) => of(shown.userRecord.taskStatusById, shown.userRecord.walkthroughProgressById, shown.userRecord.storageStatus, openId(shown)), runState);
}
