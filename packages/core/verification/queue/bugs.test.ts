// What the queue model (Shell.tla) found, each reproduced on the real Run.
// Each is `it.fails`: the suite stays green while the bug is there, and the
// test turns red once it is fixed, to be made an ordinary `it`.
import { describe, expect, it, vi } from "vitest";
import { createRun } from "../../src/run/run";
import type { RunSnapshot } from "../../src/run/types";
import type { SavePartialAdapter } from "../../src/storage/adapter";
import type { StoredRecord } from "../../src/storage/records";
import { progressOf, watch } from "../../src/test/run";
import { fakeFrames } from "../../src/test/time";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";

/** Two steps, the first pointing at a selector that does not parse. */
const badSelectorTour = defineWalkthrough({ id: "tour", steps: [{ selector: "button[" }, {}] });
const tour = defineWalkthrough({ id: "tour", steps: [{}, {}, {}] });

/** The first call gets the snapshot of subscribe; `react` runs on every later one. */
const onLaterCalls = (react: (snapshot: RunSnapshot) => void) => {
  let first = true;
  return vi.fn((snapshot: RunSnapshot) => {
    if (first) {
      first = false;
      return;
    }
    react(snapshot);
  });
};

/** A synchronous `savePartial` adapter that hears other tabs, as a localStorage-like store would. */
const syncStorage = () => {
  let push: ((record: StoredRecord | null) => void) | undefined;
  const unsubscribe = vi.fn();
  const adapter = {
    load: vi.fn(() => null),
    savePartial: vi.fn(),
    subscribe: vi.fn((listener: (record: StoredRecord | null) => void) => {
      push = listener;
      return unsubscribe;
    }),
  } satisfies SavePartialAdapter;
  const hearing = () => adapter.subscribe.mock.calls.length > unsubscribe.mock.calls.length;
  return { adapter, unsubscribe, hearing, push: (record: StoredRecord | null) => push?.(record) };
};

const attempt = (call: () => unknown): unknown => {
  try {
    call();
    return undefined;
  } catch (error) {
    return error;
  }
};

describe("a step whose selector does not parse", () => {
  // Shell.tla MessagesRun. The first look calls querySelector outside callApp (page.ts:97);
  // the drain's finally (queue.ts:66-71) then empties the queue behind it.
  it("still runs what a listener did on seeing the walkthrough open", () => {
    fakeFrames();
    const run = createRun();
    watch(run);
    let opened = false;
    run.subscribe((snapshot) => {
      if (snapshot.open !== null && !opened) {
        opened = true;
        run.act("advance");
      }
    });

    attempt(() => run.start(badSelectorTour));

    expect(opened).toBe(true);
    expect(progressOf(run)?.step).toBe(1);
  });

  // Shell.tla ErrorsSurface. The same finally drops the errors the drain had caught.
  it("still throws or reports what a listener threw before the selector failed", () => {
    fakeFrames();
    const run = createRun();
    watch(run);
    const broken = new Error("renderer broke");
    run.subscribe(onLaterCalls(() => {
      throw broken;
    }));

    const thrown = attempt(() => run.start(badSelectorTour));

    const surfaced = thrown instanceof AggregateError ? thrown.errors : [thrown];
    expect(surfaced).toContain(broken);
  });
});

describe("subscribe, under thread 12's rule (a): only the listener's own throw", () => {
  // Shell.tla SubscribeOnlyItsOwnThrow, outside a drain. subscribe.ts:9-11 removes the
  // listener whenever the drain its first call started throws, whoever threw.
  it("keeps a listener whose first call ran fine, though onEvent throws on the change it made", () => {
    fakeFrames();
    const run = createRun({
      onEvent: () => {
        throw new Error("analytics down");
      },
    });
    run.start(tour);
    let first = true;
    const listener = vi.fn(() => {
      if (first) {
        first = false;
        run.act("advance");
      }
    });

    attempt(() => run.subscribe(listener));
    const calledBefore = listener.mock.calls.length;
    attempt(() => run.act("advance"));

    expect(listener.mock.calls.length).toBeGreaterThan(calledBefore);
  });

  // Shell.tla SubscribeOnlyItsOwnThrow, inside a drain. queue.now runs the first call in
  // place (queue.ts:77), and callApp keeps its error for the drain's end, so
  // subscribe.ts:8 returns and keeps the listener.
  it("throws from a subscribe made inside a listener, and drops that listener, when its first call throws", () => {
    fakeFrames();
    const run = createRun();
    run.start(tour);
    const broken = vi.fn(() => {
      throw new Error("startup failed");
    });
    let innerThrew = false;
    const outer = vi.fn(() => {
      if (outer.mock.calls.length > 1) return;
      try {
        run.subscribe(broken);
      } catch {
        innerThrew = true;
      }
    });

    attempt(() => run.subscribe(outer));
    attempt(() => run.act("advance"));

    expect(innerThrew).toBe(true);
    expect(broken).toHaveBeenCalledOnce();
  });
});

describe("connect", () => {
  // Shell.tla HearsOnceConnected. Inside a drain, link.ts take queues `loaded`, so the
  // record is not in when connect returns. connect listens before it sends the load
  // (link.ts listen), not once the record is in, so it hears all the same.
  it("hears other tabs from the call on, even from inside a listener with a synchronous adapter", () => {
    fakeFrames();
    const storage = syncStorage();
    const run = createRun({ storage: storage.adapter });
    run.start(tour);
    let connected = false;
    run.subscribe(() => {
      if (connected) return;
      connected = true;
      run.connect();
    });

    expect(run.getSnapshot().storageStatus).toBe("ready");
    expect(storage.hearing()).toBe(true);
  });

  // Shell.tla ConnectionsHeld. When the load's change throws an app error, connect
  // (link.ts connect) has no catch: the connection is counted and hearing, and the app
  // never gets the function that would stop it. A subscribe that throws leaves the
  // connection counted too, though not hearing (Shell.tla does not model that one).
  // attach undoes itself in the same case (page.ts:222-228).
  it.fails("leaves nothing hearing other tabs when it throws a listener's error", () => {
    fakeFrames();
    const storage = syncStorage();
    const run = createRun({ storage: storage.adapter });
    run.subscribe(onLaterCalls(() => {
      throw new Error("renderer broke");
    }));

    let disconnect: (() => void) | undefined;
    const thrown = attempt(() => {
      disconnect = run.connect();
    });
    disconnect?.();

    expect(thrown).toBeInstanceOf(Error);
    expect(storage.hearing()).toBe(false);
  });
});
