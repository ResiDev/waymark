import type { StorageStatus } from "./types";
import type { WalkthroughProgress } from "../walkthrough/types";
import type { Collapsed, Opened } from "./layer";
import { stepAt } from "./state";
import type { Beacon, OpenWalkthrough, RunSnapshot } from "./types";

/*
 * The Run's snapshot, built from the core's state. Pure but for the cache,
 * which keeps each part the same object while nothing in it changed, so a
 * renderer redraws only on change. About 90 lines once filled in.
 */

export const NO_BEACONS: readonly Beacon[] = Object.freeze([]);

/** The parts last handed out, kept to be handed out again. */
export type SnapshotCache = {
  open: OpenWalkthrough | null;
  beacons: Map<string, Beacon>;
};

export const createSnapshotCache = (): SnapshotCache => ({ open: null, beacons: new Map() });

export type SnapshotInput = Readonly<{
  recordStatus: StorageStatus;
  progress: Readonly<Record<string, WalkthroughProgress>>;
  open: Opened | undefined;
  /** The task the open walkthrough guides, from the checklists layer. The core holds it as a label only. */
  task: string | null;
  collapsed: readonly Collapsed[];
}>;

/** `previous` itself when nothing a renderer shows changed. */
export function buildSnapshot(previous: RunSnapshot, input: SnapshotInput, cache: SnapshotCache): RunSnapshot {
  // TODO: as run.ts's `build` today, over openNow and beaconsNow below.
  throw new Error("not implemented");
}

/** Only while running: the same object while its walkthrough, snapshot and task are. */
function openNow(input: SnapshotInput, cache: SnapshotCache): OpenWalkthrough | null {
  throw new Error("not implemented");
}

/** Each where its Waymark is found; only the one collapsed most recently goes without, at the bottom of the screen. */
function beaconsNow(previous: readonly Beacon[], collapsed: readonly Collapsed[], cache: SnapshotCache): readonly Beacon[] {
  // TODO: as run.ts's `beaconsNow` today, reading each beacon's waymark from its `sighting`
  // and its step from stepAt(walkthrough, progress.step).
  throw new Error("not implemented");
}
