// Sketch for packages/core/src/run/beacons.ts, about 110 lines. Not compiled.
//
// Owns: sightings, where each collapsed walkthrough's Waymark was last seen.
// Pure, as walkthroughs.ts is.

import type { Beacon } from "./types";
import type { Sighting, WaymarkRead } from "./rules";
import { sight, unsighted } from "./rules";
import type { Collapsed, Left } from "./walkthroughs";

export type Sightings = ReadonlyMap<string, Sighting>;

export const NO_SIGHTINGS: Sightings = new Map();

/**
 * At the end of every change, after the walkthroughs settle: a beacon's
 * Waymark is looked for afresh each time it shows, as it may have moved while
 * another walkthrough was open. One that has just collapsed starts where it
 * last saw its Waymark. The same map when every sighting is kept.
 */
export function settle(sightings: Sightings, collapsed: readonly Collapsed[], left: Left | undefined): Sightings {
  throw new Error("not implemented");
}

/** What the frame loop measured of each beacon's Waymark, while nothing is open. */
export function look(sightings: Sightings, reads: ReadonlyMap<string, WaymarkRead>, collapsed: readonly Collapsed[], now: number): Sightings {
  // TODO: for each collapsed with a read and a sighting: sight(previous, read, now, its step). The same map when none moved.
  throw new Error("not implemented");
}

/** Nobody looked while detached, so that time does not count towards missing or lost. */
export function detached(sightings: Sightings): Sightings {
  throw new Error("not implemented");
}

/**
 * The snapshot's `beacons`: each where its Waymark is found; only the one
 * collapsed most recently goes without, at the bottom of the screen.
 * `previous` itself when nothing in it changed, and each Beacon `previous`
 * held when it did not.
 */
export function shown(sightings: Sightings, collapsed: readonly Collapsed[], previous: readonly Beacon[]): readonly Beacon[] {
  throw new Error("not implemented");
}
