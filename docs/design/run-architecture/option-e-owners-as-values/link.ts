// Sketch for packages/core/src/storage/link.ts, about 50 lines. Not compiled.
//
// The connection to storage: asks for the record once, on the first connect,
// and hears other tabs while connected and once the record is in. Moved from
// today's run.ts `connect`, `loaded` and `hearStorage`. What a record does to
// the state stays in run.ts; this file only knows when to ask and listen.

import { loadFrom } from "./adapter";
import type { Adapter } from "./adapter";
import { parseRecord } from "./records";
import type { Parsed, Read } from "./records";

/** Everything this file holds. Private: nothing outside writes it. */
type Link = {
  /** How many `connect`s are open. Other tabs are heard while there is one, so two roots can share a Run. */
  connections: number;
  /** The record is asked for on the first connect, so a server render never reads it. */
  phase: "unasked" | "asking" | "loaded";
  stopHearing: (() => void) | undefined;
};

export function createStorageLink(
  adapter: Adapter,
  on: Readonly<{
    /** The stored record, read once, on the first connect. */
    record: (read: Parsed<Read> | { failed: unknown }) => void;
    /** A record saved elsewhere, while connected and once the record is in. */
    heard: (value: unknown) => void;
  }>,
): Readonly<{ connect: () => () => void }> {
  const link: Link = { connections: 0, phase: "unasked", stopHearing: undefined };

  const hear = () => {
    if (adapter.subscribe === undefined || link.stopHearing !== undefined) return;
    if (link.connections === 0 || link.phase !== "loaded") return;
    link.stopHearing = adapter.subscribe(on.heard);
  };

  /** Hearing starts once the record is in, so a change heard lands on the record rather than on none. */
  const loaded = (read: Parsed<Read> | { failed: unknown }) => {
    link.phase = "loaded";
    try {
      on.record(read);
    } finally {
      hear();
    }
  };

  return {
    connect: () => {
      link.connections += 1;
      if (link.phase === "unasked") {
        link.phase = "asking";
        loadFrom({ adapter, onValue: (value) => loaded(parseRecord(value)), fail: (error) => loaded({ failed: error }) });
      }
      hear();
      let connected = true;
      return () => {
        if (!connected) return;
        connected = false;
        link.connections -= 1;
        if (link.connections > 0) return;
        link.stopHearing?.();
        link.stopHearing = undefined;
      };
    },
  };
}

// TODO: a Run made with `options.initial` starts "loaded": that record is in, and storage is never asked.
// createStorageLink(adapter, on, { loaded: true }), or run.ts passes the phase. Decide when implementing.
