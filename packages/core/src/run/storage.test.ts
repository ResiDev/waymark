import { afterEach, describe, expect, it, vi } from "vitest";
import { createRun } from "./run";
import type { RunEvent } from "./types";
import type { StorageAdapter } from "../storage/adapter";
import type { StoredWalkthrough } from "../storage/records";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { WalkthroughStore } from "../walkthrough/types";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

const tourIn = (storage: WalkthroughStore, maxAge?: number) =>
  defineWalkthrough([{}, {}, {}], { storage, ...(maxAge === undefined ? {} : { maxAge }) });

const held = (value: StoredWalkthrough | null) =>
  ({
    load: vi.fn(() => value),
    save: vi.fn<(value: StoredWalkthrough | null) => void>(),
  }) satisfies StorageAdapter<StoredWalkthrough>;

type RunningRecord = Extract<StoredWalkthrough, { phase: "running" }>;

const running = (overrides: Partial<RunningRecord> = {}): RunningRecord => ({
  version: 1,
  phase: "running",
  step: 1,
  stepCount: 3,
  collapsed: true,
  savedAt: Date.now(),
  ...overrides,
});

const where = (run: ReturnType<typeof createRun>) => {
  const snapshot = run.getSnapshot();
  return snapshot.phase === "running"
    ? { step: snapshot.stepIndex, collapsed: snapshot.collapsed }
    : snapshot.phase;
};

describe("run storage", () => {
  it("saves as the step changes, it collapses, and it ends", () => {
    vi.useFakeTimers({ now: 1_000 });
    const walkthrough = held(null);
    const run = createRun(tourIn(walkthrough));
    expect(walkthrough.save).not.toHaveBeenCalled();

    run.act("advance");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      running({ step: 1, collapsed: false, savedAt: 1_000 }),
    );
    run.act("collapse");
    expect(walkthrough.save).toHaveBeenLastCalledWith(running({ savedAt: 1_000 }));
    // Asking again changes nothing, so nothing is saved.
    run.act("collapse");
    expect(walkthrough.save).toHaveBeenCalledTimes(2);

    run.act("exit");
    expect(walkthrough.save).toHaveBeenLastCalledWith({ version: 1, phase: "exited" });
  });

  it("picks a running walkthrough up where it was, without saving", () => {
    const walkthrough = held(running());
    const run = createRun(tourIn(walkthrough), { startAt: 2 });
    expect(where(run)).toEqual({ step: 1, collapsed: true });
    expect(walkthrough.save).not.toHaveBeenCalled();
  });

  it.each([
    ["picks up a walkthrough begun on an earlier page", running(), []],
    ["begins one storage has nothing of", null, ["start"]],
    ["begins again one it could not pick up", running({ stepCount: 4 }), ["start"]],
  ])("sends start only when it %s", (_, stored, sent) => {
    const onEvent = vi.fn<(event: RunEvent) => void>();
    const run = createRun(tourIn(held(stored)), { onEvent });
    run.subscribe(() => {});
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(sent);
  });

  it.each(["completed", "exited"] as const)(
    "stays %s, even once its steps change, until reset",
    (phase) => {
      const walkthrough = held({ version: 1, phase });
      const run = createRun(defineWalkthrough([{}, {}], { storage: walkthrough }));
      expect(where(run)).toBe(phase);

      run.act("reset");
      expect(where(run)).toEqual({ step: 0, collapsed: false });
      expect(walkthrough.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "running", step: 0 }),
      );
    },
  );

  it.each([
    ["its steps changed", running({ stepCount: 4 })],
    ["it is older than maxAge", running({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })],
  ])("starts as asked and wipes a running walkthrough when %s", (_, stored) => {
    const walkthrough = held(stored);
    const run = createRun(tourIn(walkthrough), { startAt: 2 });
    expect(where(run)).toEqual({ step: 2, collapsed: false });
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("honours a custom maxAge", () => {
    const walkthrough = held(running({ savedAt: Date.now() - 60_000 }));
    const run = createRun(tourIn(walkthrough, 30_000));
    expect(where(run)).toEqual({ step: 0, collapsed: false });
  });

  it("reports a record it cannot read, and starts as asked", () => {
    const onStorageError = vi.fn();
    const walkthrough = held({ version: 1, phase: "running", step: 9, stepCount: 3 } as unknown as StoredWalkthrough);
    const run = createRun(defineWalkthrough([{}, {}, {}], { storage: walkthrough, onStorageError }));
    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
    expect(where(run)).toEqual({ step: 0, collapsed: false });
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("is loading until a Promise settles, holding its actions, then starts once watched", async () => {
    let answer: (value: StoredWalkthrough | null) => void = () => {};
    const walkthrough = {
      load: () =>
        new Promise<StoredWalkthrough | null>((resolve) => {
          answer = resolve;
        }),
      save: vi.fn(),
    };
    const onEvent = vi.fn<(event: RunEvent) => void>();
    const run = createRun(tourIn(walkthrough), { onEvent });
    const listener = vi.fn();
    run.subscribe(listener);
    expect(run.getSnapshot()).toEqual({ phase: "loading", stepCount: 3 });
    run.act("advance");
    expect(onEvent).not.toHaveBeenCalled();

    answer(running({ collapsed: false }));
    await Promise.resolve();

    expect(onEvent.mock.calls.map(([event]) => [event.type, event.stepIndex])).toEqual([
      ["advance", 1],
    ]);
    expect(where(run)).toEqual({ step: 2, collapsed: false });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ stepIndex: 2 }));
  });

  it("starts as asked when its load fails", async () => {
    const onStorageError = vi.fn();
    const offline = new Error("offline");
    const run = createRun(
      defineWalkthrough([{}, {}, {}], {
        storage: { load: () => Promise.reject(offline), save: () => {} },
        onStorageError,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(offline);
    expect(where(run)).toEqual({ step: 0, collapsed: false });
  });

  it.each(["completed", "exited"] as const)(
    "starts a watched %s Run again on reset, saving only its fresh start",
    (phase) => {
      const walkthrough = held({ version: 1, phase });
      const tour = tourIn(walkthrough);
      const run = createRun(tour);
      run.subscribe(() => {});

      tour.reset();
      expect(where(run)).toEqual({ step: 0, collapsed: false });
      expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ phase: "running", step: 0 }),
      );
    },
  );

  it("starts a Run reset while loading once it has loaded", async () => {
    const tour = tourIn({ load: () => Promise.resolve<StoredWalkthrough>({ version: 1, phase: "completed" }), save: vi.fn() });
    const run = createRun(tour);
    run.subscribe(() => {});

    tour.reset();
    await Promise.resolve();
    expect(where(run)).toEqual({ step: 0, collapsed: false });
  });

  it("drops a reset held while loading once nothing watches the Run, saving nothing", async () => {
    const save = vi.fn();
    const tour = tourIn({ load: () => Promise.resolve<StoredWalkthrough>({ version: 1, phase: "completed" }), save });
    const run = createRun(tour);
    const unsubscribe = run.subscribe(() => {});

    tour.reset();
    unsubscribe();
    await Promise.resolve();
    expect(where(run)).toBe("completed");
    expect(save).not.toHaveBeenCalled();
  });

  it("clears its record when no Run is watching, so the next one starts at the first step", () => {
    const tour = tourIn("tour");
    createRun(tour).act("exit");

    tour.reset();
    expect(where(createRun(tour))).toEqual({ step: 0, collapsed: false });
  });

  it("leaves a Run nothing watches any more alone on reset", () => {
    const walkthrough = held({ version: 1, phase: "completed" });
    const tour = tourIn(walkthrough);
    const dropped = createRun(tour);
    dropped.subscribe(() => {})();

    tour.reset();
    expect(where(dropped)).toBe("completed");
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("looks a key function up as each Run starts and on reset, keeping each user's place apart", () => {
    let user = "ada";
    const tour = defineWalkthrough([{}, {}], { storage: () => `tour-${user}` });
    createRun(tour).act("exit");

    user = "grace";
    expect(where(createRun(tour))).toEqual({ step: 0, collapsed: false });
    user = "ada";
    expect(where(createRun(tour))).toBe("exited");

    tour.reset();
    expect(where(createRun(tour))).toEqual({ step: 0, collapsed: false });
  });

  it("reports a record reset cannot clear to the walkthrough's onStorageError", () => {
    const onStorageError = vi.fn();
    const quota = new Error("quota");
    const tour = defineWalkthrough([{}, {}], {
      storage: { load: () => null, save: () => { throw quota; } },
      onStorageError,
    });

    tour.reset();
    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(quota);
  });

  it("reports a key function that throws, and runs unstored", () => {
    const onStorageError = vi.fn();
    const signedOut = new Error("signed out");
    const tour = defineWalkthrough([{}, {}], {
      storage: () => {
        throw signedOut;
      },
      onStorageError,
    });

    expect(where(createRun(tour))).toEqual({ step: 0, collapsed: false });
    tour.reset();
    expect(onStorageError.mock.calls).toEqual([[signedOut], [signedOut]]);
  });

  it("starts a watched Run without storage again on reset", () => {
    const tour = defineWalkthrough([{}, {}]);
    const run = createRun(tour);
    run.subscribe(() => {});
    run.act("exit");

    tour.reset();
    expect(where(run)).toEqual({ step: 0, collapsed: false });
  });

  it("keeps a finished tour finished across a reload through localStorage", () => {
    const first = createRun(tourIn("tour"));
    first.act("advance");
    first.act("advance");
    first.act("advance");

    const reloaded = createRun(tourIn("tour"));
    expect(where(reloaded)).toBe("completed");
  });
});
