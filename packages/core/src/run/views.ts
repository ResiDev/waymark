import { statusIn } from "../checklists/record";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot } from "../checklists/types";
import type { Given, Live, Recorded, Shown, Visit } from "../state";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { memo } from "./memo";
import { storageStatus } from "./record";
import { running, stepAt } from "./rules";
import { taskFor } from "./tasks";
import type { Beacon, OpenWalkthrough, Running, RunSnapshot } from "./types";
import { collapsed, openId, openOf, sightingOf } from "./walkthroughs";
import type { Collapsed } from "./walkthroughs";

/** What the Run hands out, worked out from the facts: the same object until something in it moves. */
export type View<T> = Readonly<{
  /** Worked out from these facts, and what `current` hands back until the next. */
  update: (facts: Shown) => T;
  current: () => T;
}>;

function viewOf<T>(of: (facts: Shown) => T, facts: Shown): View<T> {
  let shown = of(facts);
  return {
    update: (next) => (shown = of(next)),
    current: () => shown,
  };
}

/** The walkthroughs drawn as beacons, cached by what they are read from. */
export function collapsedOf(): (facts: Shown) => Collapsed {
  const of = memo(([recorded, walkthroughs, opened]: readonly [Recorded, Given["walkthroughs"], string | undefined]) =>
    collapsed(recorded, walkthroughs, opened),
  );
  return (facts) => of(facts.recorded, facts.given.walkthroughs, openId(facts));
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

type OpenArgs = readonly [Walkthrough | undefined, WalkthroughProgress | undefined, Visit | undefined, readonly ChecklistGroup[]];

function openShown([walkthrough, entry, visit, groups]: OpenArgs, last: OpenWalkthrough | null | undefined): OpenWalkthrough | null {
  if (walkthrough === undefined || entry === undefined || visit === undefined) return null;
  const made = running({ walkthrough, entry, visit });
  const snapshot = last?.walkthrough === walkthrough && sameRunning(last.snapshot, made) ? last.snapshot : made;
  const task = taskFor(groups, walkthrough.id);
  return last?.snapshot === snapshot && last.task === task ? last : { walkthrough, snapshot, task };
}

/** Each where its Waymark is found; only the one collapsed most recently goes without, at the bottom of the screen. */
function beaconsShown([candidates, sightings]: readonly [Collapsed, Live["beacons"]], last: readonly Beacon[] | undefined): readonly Beacon[] {
  let latest: Walkthrough | undefined;
  let latestAt = -Infinity;
  for (const [walkthrough, entry] of candidates) {
    if (entry.changedAt >= latestAt) {
      latest = walkthrough;
      latestAt = entry.changedAt;
    }
  }
  const shown: Beacon[] = [];
  for (const [walkthrough, entry] of candidates) {
    const { waymark } = sightingOf(sightings, walkthrough, entry);
    const anywhere = waymark.status === "absent" || waymark.status === "lost" || waymark.status === "missing";
    if (waymark.status !== "found" && !(anywhere && walkthrough === latest)) continue;
    const was = last?.find((beacon) => beacon.walkthrough === walkthrough);
    shown.push(
      was?.stepIndex === entry.step && was.waymark === waymark
        ? was
        : { walkthrough, step: stepAt(walkthrough, entry.step), stepIndex: entry.step, waymark },
    );
  }
  if (shown.length === 0) return NO_BEACONS;
  return last !== undefined && sameList(shown, last) ? last : shown;
}

/** The Run's snapshot. Each part is cached by what it reads, so a frame that moved no fact builds nothing. */
export function runView(collapsedNow: (facts: Shown) => Collapsed, facts: Shown): View<RunSnapshot> {
  const open = memo(openShown);
  const beacons = memo(beaconsShown);
  const snapshot = memo(
    ([status, progress, opened, shown]: readonly [RunSnapshot["storageStatus"], Recorded["progress"], OpenWalkthrough | null, readonly Beacon[]]): RunSnapshot => ({
      storageStatus: status,
      progress,
      open: opened,
      beacons: shown,
    }),
  );
  const of = memo(([given, recorded, live]: readonly [Given, Recorded, Live]) => {
    const shown = { given, recorded, live };
    const on = openOf(shown);
    return snapshot(
      storageStatus(recorded.storage),
      recorded.progress,
      open(on?.walkthrough, on?.entry, on?.visit, given.groups),
      beacons(collapsedNow(shown), live.beacons),
    );
  });
  return viewOf((shown) => of(shown.given, shown.recorded, shown.live), facts);
}

type Snapshot = ChecklistSnapshot<AnyTask>;

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.open === b.open &&
  a.storageStatus === b.storageStatus &&
  a.tasks.every((row, index) => row.status === b.tasks[index]?.status && row.inProgress === b.tasks[index].inProgress);

/** One checklist's snapshot, made the first time the checklist is used. */
export function checklistView(definition: ChecklistDefinition<AnyTask>, facts: Shown): View<Snapshot> {
  const walkthroughOf = new Map(definition.group.tasks.map((task) => [task.id, task.walkthrough?.id]));
  type Args = readonly [Recorded["statuses"], Recorded["progress"], Recorded["storage"], string | undefined];
  const of = memo(([statuses, progress, storage, opened]: Args, last: Snapshot | undefined): Snapshot => {
    const tasks = definition.tasks.map((task) => {
      const walkthrough = walkthroughOf.get(task.id);
      const entry = walkthrough === undefined ? undefined : progress[walkthrough];
      return { task, status: statusIn(statuses, task.id), inProgress: entry?.status === "running" && entry.collapsed };
    });
    const finishedCount = tasks.filter((row) => row.status !== "todo").length;
    const next: Snapshot = {
      tasks,
      finishedCount,
      taskCount: tasks.length,
      complete: finishedCount === tasks.length,
      open: opened === undefined ? null : (definition.tasks.find((task) => walkthroughOf.get(task.id) === opened) ?? null),
      storageStatus: storageStatus(storage),
    };
    return last !== undefined && sameSnapshot(last, next) ? last : next;
  });
  return viewOf((shown) => of(shown.recorded.statuses, shown.recorded.progress, shown.recorded.storage, openId(shown)), facts);
}
