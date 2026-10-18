// packages/core/src/run/beacons.ts — about 100 lines.
//
// Owns: `sightings`, where each collapsed walkthrough's Waymark is while none
// is open.
//
// Which beacons show, and where, is decided here: each where its Waymark is
// found, and only the one collapsed most recently anywhere else. Which
// walkthroughs are collapsed is not: that is `walkthroughs.collapsed()`, read
// fresh each time, never copied.

import { hasWaymark } from "../walkthrough/walkthrough";
import type { Change } from "./change";
import { sight, unsighted } from "./rules";
import type { Sighting, WaymarkRead } from "./rules";
import { stepAt } from "./state";
import type { Beacon } from "./types";
import type { Left, Walkthroughs } from "./walkthroughs";

/** Finds a Waymark on the page, reusing `cached` while it still matches. The page's, handed in, so nothing here touches the DOM. */
export type Measure = (selector: string, cached: Element | null) => WaymarkRead;

export type Beacons = Readonly<{
  // The pipeline's step. Only `commit` calls it.

  /**
   * At the end of every change, after `walkthroughs.settle`: a beacon's
   * Waymark is looked for afresh each time it shows, as it may have moved
   * while another walkthrough was open. One that has just collapsed starts
   * where it last saw its Waymark.
   */
  settle: (change: Change, left: Left | undefined) => void;

  // Writes, from the page.

  /** Each beacon's Waymark measured, once a frame while none is open. */
  look: (change: Change, measure: Measure, now: number) => void;
  /** Nobody looked while detached, so that time does not count towards missing or lost. */
  detached: (change: Change) => void;

  // Reads.

  /** The snapshot's `beacons`: `previous` itself when none changed, and each beacon `previous` held when it did not. */
  shown: (previous: readonly Beacon[]) => readonly Beacon[];
  /** A beacon shows on a step with a Waymark, so frames are wanted to find it. */
  toLookFor: () => boolean;
}>;

const NO_BEACONS: readonly Beacon[] = Object.freeze([]);

export function createBeacons(walkthroughs: Pick<Walkthroughs, "collapsed">): Beacons {
  let sightings = new Map<string, Sighting>();

  return {
    settle: (_change, left) => {
      // TODO: as the second half of `settle` today, with the sighting `release` used to write handed in:
      // if (left !== undefined) sightings.set(left.id, left.sighting);
      // const shown = new Map<string, Sighting>();
      // for (const { walkthrough, saved } of walkthroughs.collapsed()) {
      //   const sighting = sightings.get(walkthrough.id);
      //   shown.set(walkthrough.id, sighting?.stepIndex === saved.step ? sighting : unsighted(stepAt(walkthrough, saved.step), saved.step));
      // }
      // sightings = shown;
      throw new Error("not implemented");
    },
    look: (_change, measure, now) => {
      // TODO: as `lookAtBeacons` today:
      // for each collapsed with a selector on its step and a sighting:
      //   sightings.set(id, sight(previous, measure(selector, previous.element), now, step));
      throw new Error("not implemented");
    },
    detached: (_change) => {
      // TODO: every sighting with `unseenSince: undefined`.
      throw new Error("not implemented");
    },
    shown: (previous) => {
      // TODO: as `beaconsNow` today, with `previous` as the cache in place of `beaconsShown`:
      // latest = the collapsed walkthrough with the greatest `changedAt` (ties to the later one);
      // for each collapsed with a sighting:
      //   skip unless its waymark is `found`, or it is `latest` and its waymark is absent, lost or missing;
      //   reuse the beacon in `previous` for this walkthrough when its stepIndex and waymark are the same;
      // NO_BEACONS when none; `previous` when every beacon is the one at the same index in it.
      throw new Error("not implemented");
    },
    toLookFor: () => {
      // TODO: walkthroughs.collapsed().some(({ walkthrough, saved }) => hasWaymark(stepAt(walkthrough, saved.step)))
      throw new Error("not implemented");
    },
  };
}
