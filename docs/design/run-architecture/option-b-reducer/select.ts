// Sketch: packages/core/src/run/select.ts (~190 lines implemented)
// What a state shows. Pure reads of a RunState: the snapshots (each given the
// one before, so it can hand back what did not change), the page watchers it
// wants, and the few questions the shell asks between changes.

import { statusIn } from "../checklists/record";
import { conditionsDue as due } from "../checklists/tasks";
import type { AnyTask, ChecklistDefinition, ChecklistSnapshot } from "../checklists/types";
import { dictionary } from "../dictionary";
import { hasWaymark, selectorOf } from "../walkthrough/walkthrough";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import type { RunState } from "./model";
import { liveWatchers, NOTHING_LIVE } from "./rules";
import type { LiveWatchers } from "./rules";
import { stepAt } from "./state";
import type { Beacon, OpenWalkthrough, RunSnapshot } from "./types";

export const NO_PROGRESS: Readonly<Record<string, WalkthroughProgress>> = Object.freeze(dictionary<WalkthroughProgress>());
export const NO_BEACONS: readonly Beacon[] = Object.freeze([]);

/** Collapsed walkthroughs the Run can draw as beacons: none while one is open, and none still waiting for its definition. */
export function collapsedNow(state: RunState): readonly (readonly [Walkthrough, WalkthroughProgress])[] {
  if (state.open !== undefined) return [];
  const found: (readonly [Walkthrough, WalkthroughProgress])[] = [];
  for (const [id, saved] of Object.entries(state.record.progress)) {
    const walkthrough = state.known.walkthroughs.get(id);
    if (saved.status === "running" && saved.collapsed && walkthrough !== undefined && !state.restored.has(id)) {
      found.push([walkthrough, saved]);
    }
  }
  return found;
}

// Snapshots

/** `previous` itself when nothing in it changed, and each of its parts that did not. */
export function selectRun(state: RunState, previous: RunSnapshot): RunSnapshot {
  // TODO: as run.ts `build`: open = openOf(state, previous.open); beacons = beaconsOf(state, previous.beacons);
  // previous when storageStatus, record.progress, open and beacons are all the same objects.
  throw new Error("not implemented");
}

/** `previous` when the walkthrough, its snapshot and its task are the same. */
function openOf(state: RunState, previous: OpenWalkthrough | null): OpenWalkthrough | null {
  // TODO: open undefined or not running -> null.
  // task = first of known.tasks.values() whose walkthrough id is the open one's, else null.
  throw new Error("not implemented");
}

/**
 * Each where its Waymark is found; only the one collapsed most recently goes
 * without, at the bottom of the screen. A beacon is reused from `previous`
 * when its walkthrough, step and Waymark are the same, and the array when
 * every beacon is: `beaconsShown` is just the last snapshot's beacons.
 */
function beaconsOf(state: RunState, previous: readonly Beacon[]): readonly Beacon[] {
  // TODO: as run.ts `beaconsNow`, with `last` = previous.find((b) => b.walkthrough.id === id) in place of beaconsShown.
  // Differs only in a beacon hidden and shown again with the very same Waymark object, which gets a new,
  // equal object: settle rebuilds sightings whenever one opens, so this is rare and invisible.
  throw new Error("not implemented");
}

/**
 * A checklist's snapshot, `previous` when no row, its open Task or its
 * storage status changed. It reads only the record, the open walkthrough's
 * id and the storage status, so a server snapshot is this over the state
 * from before the load.
 */
export function selectChecklist(
  state: RunState,
  definition: ChecklistDefinition<AnyTask>,
  previous: ChecklistSnapshot<AnyTask> | undefined,
): ChecklistSnapshot<AnyTask> {
  // TODO: as views.ts `snapshotOf`, over definition.tasks with definition.defined[i] for each row's walkthrough:
  //   status = statusIn(record.statuses, task.id)
  //   inProgress = progress[walkthroughId]?.status === "running" && collapsed
  //   open = first task whose walkthroughId === state.open?.walkthrough.id, else null
  // previous && sameSnapshot(previous, next) ? previous : next   (sameSnapshot moves here from views.ts)
  throw new Error("not implemented");
}

// The page

/**
 * The page watchers this state wants. Keys are values (an element, a step
 * generation), so the same state wants equal keys and the shell reopens nothing.
 */
export function wanted(state: RunState, attached: boolean): LiveWatchers {
  const live = state.open === undefined ? NOTHING_LIVE : liveWatchers(state.open.state);
  const beacons =
    attached && collapsedNow(state).some(([walkthrough, saved]) => hasWaymark(stepAt(walkthrough, saved.step)));
  return beacons && !live.frame ? { ...live, frame: true } : live;
}

// For the shell, between changes

/** A beacon's Waymark the frame loop measures, with the element it was last seen as. */
export type BeaconTarget = Readonly<{ id: string; selector: string; element: Element | null }>;

/** While none is open: each collapsed walkthrough whose step has a Waymark, and a sighting to update. */
export function beaconTargets(state: RunState): readonly BeaconTarget[] {
  // TODO: for [w, saved] of collapsedNow(state): selector = selectorOf(stepAt(w, saved.step)),
  // sighting = sightings.get(w.id); both there -> { id, selector, element: sighting.element }.
  throw new Error("not implemented");
}

/** A Task with a condition, narrowed so the shell can call it without checking again. */
export type Condition = Readonly<{ id: string; isComplete: (context: unknown) => boolean }>;

/** The conditions the shell asks before a change, in task order: each Task with one, not done. */
export function conditionsDue(state: RunState): readonly Condition[] {
  return due(state.known.tasks.values(), state.record.statuses);
}

/** A Task's walkthrough, as `checklist.start` takes it: from the Task the Run knows by that id. */
export function taskWalkthrough(state: RunState, id: string): Walkthrough | undefined {
  return state.known.tasks.get(id)?.walkthrough;
}
