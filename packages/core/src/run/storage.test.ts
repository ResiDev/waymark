import { afterEach, describe, expect, it, vi } from "vitest";
import { createRun } from "./run";
import type { RunEvent } from "./types";
import { localStorageAdapter } from "../storage/adapter";
import type { StorageAdapter } from "../storage/adapter";
import type { StoredWalkthrough } from "../storage/records";
import { defineWalkthrough } from "../walkthrough/walkthrough";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

const tour = defineWalkthrough([{}, {}, {}]);

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
    const run = createRun(tour, { storage: { walkthrough } });
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
    const run = createRun(tour, { storage: { walkthrough }, startAt: 2 });
    expect(where(run)).toEqual({ step: 1, collapsed: true });
    expect(walkthrough.save).not.toHaveBeenCalled();
  });

  it.each([
    ["picks up a walkthrough begun on an earlier page", running(), []],
    ["begins one storage has nothing of", null, ["start"]],
    ["begins again one it could not pick up", running({ stepCount: 4 }), ["start"]],
  ])("sends start only when it %s", (_, stored, sent) => {
    const onEvent = vi.fn<(event: RunEvent) => void>();
    const run = createRun(tour, { storage: { walkthrough: held(stored) }, onEvent });
    run.subscribe(() => {});
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(sent);
  });

  it.each(["completed", "exited"] as const)(
    "stays %s, even once its steps change, until reset",
    (phase) => {
      const walkthrough = held({ version: 1, phase });
      const run = createRun(defineWalkthrough([{}, {}]), { storage: { walkthrough } });
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
    const run = createRun(tour, { storage: { walkthrough }, startAt: 2 });
    expect(where(run)).toEqual({ step: 2, collapsed: false });
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("honours a custom maxAge", () => {
    const walkthrough = held(running({ savedAt: Date.now() - 60_000 }));
    const run = createRun(tour, { storage: { walkthrough, maxAge: 30_000 } });
    expect(where(run)).toEqual({ step: 0, collapsed: false });
  });

  it("reports a record it cannot read, and starts as asked", () => {
    const onStorageError = vi.fn();
    const walkthrough = held({ version: 1, phase: "running", step: 9, stepCount: 3 } as unknown as StoredWalkthrough);
    const run = createRun(tour, { storage: { walkthrough }, onStorageError });
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
    const run = createRun(tour, { storage: { walkthrough }, onEvent });
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
    const run = createRun(tour, {
      storage: { walkthrough: { load: () => Promise.reject(offline), save: () => {} } },
      onStorageError,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(offline);
    expect(where(run)).toEqual({ step: 0, collapsed: false });
  });

  it("keeps a finished tour finished across a reload through localStorage", () => {
    const first = createRun(tour, { storage: { walkthrough: localStorageAdapter("tour") } });
    first.act("advance");
    first.act("advance");
    first.act("advance");

    const reloaded = createRun(tour, { storage: { walkthrough: localStorageAdapter("tour") } });
    expect(where(reloaded)).toBe("completed");
  });
});
