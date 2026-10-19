import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createRun } from "./run";
import { everyProblem } from "../problems";
import type { RunOptions, WaymarkEvent } from "./types";
import { RecordUnreadableError } from "../storage/records";
import type { StoredRecord } from "../storage/records";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { Dismiss, WalkthroughProgress } from "../walkthrough/types";
import { localKey } from "../test/dom";
import { connected, progressOf, watch } from "../test/run";
import { elsewhere, held, later } from "../test/storage";
import { fakeFrames, fakeTimers } from "../test/time";

const tour = defineWalkthrough({ id: "tour", steps: [{}, {}, {}] });

const progress = (overrides: Partial<WalkthroughProgress> = {}): WalkthroughProgress => ({
  status: "running",
  step: 1,
  stepCount: 3,
  collapsed: true,
  changedAt: Date.now(),
  ...overrides,
});

const record = (walkthroughs: StoredRecord["walkthroughs"], tasks: StoredRecord["tasks"] = {}): StoredRecord => ({
  version: 1,
  walkthroughs,
  tasks,
});

const failed = (error: unknown) => ({ type: "storageFailed", error });

const types = (onEvent: { mock: { calls: [WaymarkEvent][] } }) => onEvent.mock.calls.map(([event]) => event.type);

describe("run storage", () => {
  it("saves the walkthrough's entry as the step changes, it collapses and it ends", () => {
    fakeTimers(1_000);
    const storage = held(null);
    const run = connected({ storage });
    expect(storage.save).not.toHaveBeenCalled();

    run.start(tour);
    expect(storage.save).toHaveBeenLastCalledWith({
      version: 1,
      walkthroughs: { tour: progress({ step: 0, collapsed: false, changedAt: 1_000 }) },
      tasks: {},
    });
    run.act("advance");
    run.act("collapse");
    expect(storage.stored()).toEqual(record({ tour: progress({ changedAt: 1_000 }) }));
    // Asking again changes nothing, so nothing is saved.
    run.act("collapse", tour);
    expect(storage.save).toHaveBeenCalledTimes(3);

    run.act("exit", tour);
    expect(storage.stored()).toEqual(record({ tour: progress({ status: "exited", collapsed: false, changedAt: 1_000 }) }));
  });

  it("does not save a look that moves nothing it keeps", () => {
    const { flush } = fakeFrames();
    const storage = held(null);
    const run = connected({ storage });
    run.start(defineWalkthrough({ id: "tour", steps: [{ waymark: "save" }] }));
    watch(run);
    storage.save.mockClear();

    flush(3000);
    expect(run.getSnapshot().open?.snapshot.waymark.status).toBe("missing");
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("picks a walkthrough up where it was once its definition arrives, without saving", () => {
    const storage = held(record({ tour: progress({ collapsed: false }) }));
    const run = connected({ storage });
    expect(run.getSnapshot().open).toBeNull();

    run.requestStart(tour);
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 1, collapsed: false });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it.each([
    ["picks up a walkthrough begun on an earlier page", record({ tour: progress({ collapsed: false }) }), []],
    ["begins one storage has nothing of", null, ["start"]],
    ["begins again one it could not pick up", record({ tour: progress({ stepCount: 4 }) }), ["start"]],
  ])("sends start only when it %s", (_, stored, sent) => {
    fakeFrames();
    const onEvent = vi.fn<(event: WaymarkEvent) => void>();
    const run = connected({ storage: held(stored), onEvent, problemHandlers: { recordDropped: () => {} } });
    run.requestStart(tour);
    watch(run);
    expect(types(onEvent)).toEqual(sent);
  });

  it.each(["finished", "exited"] as const)(
    "stays %s, even once its steps change, until started again",
    (status) => {
      const storage = held(record({ tour: progress({ status, stepCount: 2 }) }));
      const run = connected({ storage });
      run.requestStart(tour);
      expect(run.getSnapshot().open).toBeNull();
      expect(progressOf(run)?.status).toBe(status);

      run.start(tour);
      expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
      expect(storage.stored()).toEqual(
        expect.objectContaining({ walkthroughs: { tour: expect.objectContaining({ status: "running", step: 0 }) } }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      );
    },
  );

  it.each([
    ["its steps changed", progress({ stepCount: 4 }), "stepsChanged"],
    ["it is older than maxAge", progress({ changedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 }), "expired"],
  ])("drops and reports progress part way through when %s, once the definition arrives", (_, stored, reason) => {
    const storage = held(record({ tour: stored }, { hello: "done" }));
    const onProblem = vi.fn();
    const run = connected({ storage, problemHandlers: everyProblem(onProblem) });
    expect(onProblem).not.toHaveBeenCalled();

    run.requestStart(tour);
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "recordDropped", walkthrough: "tour", reason });
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
    expect(storage.stored()).toEqual(
      record({ tour: expect.objectContaining({ step: 0, stepCount: 3 }) }, { hello: "done" }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    );
  });

  it("keeps the progress a handler starts on hearing the stored progress was dropped", () => {
    const storage = held(record({ tour: progress({ stepCount: 4 }) }));
    const run = connected({ storage, problemHandlers: { recordDropped: () => run.start(tour) } });

    // Collapsing it hands the Run its definition, which drops the stored progress.
    run.act("collapse", tour);
    expect(run.getSnapshot().open?.walkthrough.id).toBe("tour");
    expect(storage.save.mock.lastCall?.[0].walkthroughs["tour"]).toMatchObject({ status: "running", step: 0 });
  });

  it("honours a custom maxAge", () => {
    const storage = held(record({ tour: progress({ changedAt: Date.now() - 60_000, collapsed: false }) }));
    const run = connected({ storage, problemHandlers: { recordDropped: () => {} } });
    run.requestStart(defineWalkthrough({ id: "tour", steps: [{}, {}, {}], maxAge: 30_000 }));
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
  });

  it("waits for its definition, showing no beacon and holding off no request", () => {
    const storage = held(record({ tour: progress({ collapsed: false }), aside: progress() }));
    const run = connected({ storage });
    expect(run.getSnapshot()).toMatchObject({ open: null, beacons: [] });

    run.requestStart(defineWalkthrough({ id: "whatsNew", steps: [{}] }));
    expect(run.getSnapshot().open?.walkthrough.id).toBe("whatsNew");
  });

  it.each([
    ["collapse", { status: "running", collapsed: true }],
    ["exit", { status: "exited" }],
  ] as const)(
    "sets restored progress aside as its dismiss, %s, says when another walkthrough is open as its definition arrives",
    (dismiss: Dismiss, after) => {
      const storage = held(record({ tour: progress({ collapsed: false }) }));
      const onEvent = vi.fn<(event: WaymarkEvent) => void>();
      const run = connected({ storage, onEvent });
      run.start(defineWalkthrough({ id: "whatsNew", steps: [{}] }));

      run.requestStart(defineWalkthrough({ id: "tour", steps: [{}, {}, {}], dismiss }));
      expect(run.getSnapshot().open?.walkthrough.id).toBe("whatsNew");
      expect(progressOf(run)).toMatchObject({ step: 1, ...after });
      expect(onEvent).not.toHaveBeenCalled();
    },
  );

  it("reports a record it cannot read once, starts afresh, and never saves over it", () => {
    const onProblem = vi.fn();
    const unreadable = { version: 2, walkthroughs: {}, tasks: {} } as unknown as StoredRecord;
    const storage = held(unreadable);
    const run = connected({ storage, problemHandlers: everyProblem(onProblem) });
    expect(onProblem).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "recordUnreadable", error: expect.any(Error), stored: unreadable }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    );
    expect(run.getSnapshot()).toMatchObject({ storageStatus: "error", progress: {} });
    expect(storage.save).not.toHaveBeenCalled();

    run.requestStart(tour);
    run.act("advance");
    expect(run.getSnapshot().open?.snapshot.stepIndex).toBe(1);
    expect(storage.stored()).toBe(unreadable);
    expect(storage.save).toHaveBeenCalled();
    expect(onProblem).toHaveBeenCalledOnce();
  });

  it("names a newer version it cannot read", () => {
    const onProblem = vi.fn();
    connected({ storage: held({ version: 2 } as unknown as StoredRecord), problemHandlers: everyProblem(onProblem) });
    expect(onProblem).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "recordUnreadable",
        error: expect.objectContaining({ message: expect.stringMatching(/version 2.*reads up to 1/) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      }),
    );
  });

  it("keeps the rest of a record when a walkthrough's progress cannot be read, and drops that one from storage", () => {
    const onProblem = vi.fn();
    const hint = progress({ status: "finished" });
    const storage = held({ version: 1, walkthroughs: { tour: { status: "running", step: 9, stepCount: 3 }, hint }, tasks: {} } as unknown as StoredRecord);
    const run = connected({ storage, problemHandlers: everyProblem(onProblem) });
    expect(run.getSnapshot()).toMatchObject({ storageStatus: "ready", progress: { hint } });
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "recordDropped", walkthrough: "tour", reason: "unreadable" });

    run.start(tour);
    expect(storage.stored()).toMatchObject({ walkthroughs: { hint, tour: { status: "running", step: 0 } } });
  });

  it("reports a save storage refused as the record it cannot read, once, with the record it holds", () => {
    const onProblem = vi.fn();
    const newer = { version: 2 };
    const save = vi.fn(() => {
      throw new RecordUnreadableError("newer", newer);
    });
    const run = connected({ storage: { load: () => null, save }, problemHandlers: everyProblem(onProblem) });
    run.start(tour);
    run.act("advance");
    expect(save).toHaveBeenCalledTimes(2);
    expect(onProblem).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "recordUnreadable", stored: newer }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    );
  });

  it("reports a record it cannot read once, whether it loaded it, heard it or storage refused a save over it", () => {
    const onProblem = vi.fn();
    const newer = { version: 2, walkthroughs: {}, tasks: {} } as unknown as StoredRecord;
    const { storage, push } = elsewhere(newer);
    const run = connected({ storage, problemHandlers: everyProblem(onProblem) });
    push({ version: 3 } as unknown as StoredRecord);
    run.start(tour);
    expect(storage.save).toHaveBeenCalledOnce();
    expect(storage.stored()).toBe(newer);

    expect(onProblem.mock.calls).toEqual([
      [expect.objectContaining({ type: "recordUnreadable", stored: newer })], // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    ]);
  });

  it("reports a record it cannot read again once it has heard one it can read", () => {
    const onProblem = vi.fn();
    const { storage, push } = elsewhere(record({}));
    const run = connected({ storage, problemHandlers: everyProblem(onProblem) });
    const newer = { version: 2 } as unknown as StoredRecord;
    const newest = { version: 3 } as unknown as StoredRecord;

    push(newer);
    push(record({ tour: progress() }));
    expect(progressOf(run)).toMatchObject({ status: "running" });
    push(newest);

    expect(onProblem.mock.calls).toEqual([
      [expect.objectContaining({ type: "recordUnreadable", stored: newer })], // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      [expect.objectContaining({ type: "recordUnreadable", stored: newest })], // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    ]);
  });

  describe("replace", () => {
    /** A Run on a record it cannot read, and the `replace` its problem brings. */
    const unreadableRun = () => {
      const storage = held({ version: 2 } as unknown as StoredRecord);
      let replace: ((record: StoredRecord | null) => void) | undefined;
      const run = connected({
        storage,
        problemHandlers: {
          recordUnreadable: (problem) => {
            replace = problem.replace;
          },
        },
      });
      if (replace === undefined) throw new Error("No recordUnreadable came.");
      return { run, storage, replace };
    };

    it("takes the app's record in place of one it cannot read, with what the user did since on top, and saves the whole", () => {
      const { run, storage, replace } = unreadableRun();
      run.start(tour);
      run.act("advance");
      const hint = progress({ status: "finished" });

      replace(record({ hint, tour: progress({ step: 2 }) }, { met: "done" }));
      expect(run.getSnapshot()).toMatchObject({ storageStatus: "ready", progress: { hint, tour: { step: 1 } } });
      expect(storage.stored()).toMatchObject({ version: 1, walkthroughs: { hint, tour: { step: 1 } }, tasks: { met: "done" } });

      // Storage reads again, so the next change saves as any does.
      run.act("advance");
      expect(storage.stored()).toMatchObject({ walkthroughs: { hint, tour: { step: 2 } }, tasks: { met: "done" } });
    });

    it("starts over from what the user did since, given none", () => {
      const { run, storage, replace } = unreadableRun();
      run.start(tour);
      replace(null);
      expect(storage.stored()).toEqual(record({ tour: expect.objectContaining({ status: "running", step: 0 }) })); // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      expect(run.getSnapshot().storageStatus).toBe("ready");
    });

    it("throws on a record it cannot take, and leaves storage as it was", () => {
      const { storage, replace } = unreadableRun();
      expect(() => replace({ version: 2 } as unknown as StoredRecord)).toThrow(/cannot take the record given to replace/);
      expect(storage.stored()).toEqual({ version: 2 });
    });
  });

  it("is loading until a Promise settles, then runs the commands held meanwhile in order", async () => {
    const { adapter, answer } = later(record({ tour: progress({ collapsed: false }) }));
    const onEvent = vi.fn<(event: WaymarkEvent) => void>();
    const run = connected({ storage: adapter, onEvent });
    const listener = vi.fn();
    run.subscribe(listener);
    expect(run.getSnapshot()).toMatchObject({ storageStatus: "loading", open: null });

    run.requestStart(tour);
    run.act("advance");
    run.start(defineWalkthrough({ id: "hint", steps: [{}] }));
    expect(onEvent).not.toHaveBeenCalled();

    await answer();

    expect(onEvent.mock.calls.map(([event]) => ("walkthrough" in event ? `${event.walkthrough}:${event.type}` : event.type))).toEqual([
      "tour:advance",
      "tour:interrupt",
    ]);
    expect(progressOf(run)).toMatchObject({ step: 2, collapsed: true });
    expect(run.getSnapshot().open?.walkthrough.id).toBe("hint");
    expect(listener).toHaveBeenLastCalledWith(run.getSnapshot());
  });

  it("starts empty with an error status when its load fails, and reports it", async () => {
    const { adapter, refuse } = later();
    const onProblem = vi.fn();
    const run = connected({ storage: adapter, problemHandlers: everyProblem(onProblem) });
    const offline = new Error("offline");
    run.requestStart(tour);

    await refuse(offline);

    expect(onProblem).toHaveBeenCalledExactlyOnceWith(failed(offline));
    expect(run.getSnapshot().storageStatus).toBe("error");
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
  });

  it.each([
    ["throws", () => { throw new Error("quota"); }],
    ["rejects", () => Promise.reject(new Error("quota"))],
  ])("keeps the new step when a save %s, and reports storageFailed", async (_, save) => {
    const onProblem = vi.fn();
    const run = connected({ storage: { load: () => null, save }, problemHandlers: everyProblem(onProblem) });
    run.start(tour);
    run.act("advance");
    await Promise.resolve();

    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 1 });
    expect(onProblem).toHaveBeenCalledWith(failed(new Error("quota")));
  });

  it.each<[string, RunOptions]>([
    ["no handlers", {}],
    ["handlers for other problems", { problemHandlers: { waymarkMissing: () => {} } }],
  ])("logs storage failures when given %s", (_, handlers) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked = new Error("blocked");
    connected({
      storage: {
        load: () => {
          throw blocked;
        },
        save: () => {},
      },
      ...handlers,
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("storage"), blocked);
  });

  it("takes `initial` in place of loading, and still saves", () => {
    const storage = held(record({ tour: progress({ status: "finished" }) }));
    const run = connected({ storage, initial: record({ tour: progress({ collapsed: false }) }) });
    expect(storage.load).not.toHaveBeenCalled();
    run.requestStart(tour);
    expect(run.getSnapshot().open?.snapshot.stepIndex).toBe(1);

    run.act("advance");
    expect(storage.stored()).toEqual(record({ tour: expect.objectContaining({ step: 2 }) })); // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
  });

  it("hands each change of the record to onChange, with or without storage", () => {
    fakeTimers(1_000);
    const onChange = vi.fn();
    const run = createRun({ onChange });
    run.start(tour);
    expect(onChange).toHaveBeenLastCalledWith(record({ tour: progress({ step: 0, collapsed: false, changedAt: 1_000 }) }));
  });

  it("hears a change made elsewhere without moving the open walkthrough, and saves only its own next change", () => {
    const { storage, push } = elsewhere(record({}));
    const onEvent = vi.fn<(event: WaymarkEvent) => void>();
    const run = connected({ storage, onEvent });
    run.start(tour);
    onEvent.mockClear();
    storage.save.mockClear();

    push(record({ tour: progress({ step: 2, collapsed: false }) }, { hello: "done" }));
    expect(run.getSnapshot().open?.snapshot.stepIndex).toBe(0);
    expect(storage.save).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();

    run.act("advance");
    expect(storage.save).toHaveBeenLastCalledWith({
      version: 1,
      walkthroughs: { tour: expect.objectContaining({ step: 1 }) }, // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      tasks: {},
    });
  });

  it("takes another tab's progress for every walkthrough not open here", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    const hint = defineWalkthrough({ id: "hint", steps: [{}] });
    run.start(hint);

    push(record({ tour: progress({ status: "finished" }) }));
    run.requestStart(tour);
    expect(run.getSnapshot().open?.walkthrough.id).toBe("hint");
    expect(progressOf(run)?.status).toBe("finished");
  });

  it("collapses a walkthrough heard open elsewhere, so only one is open here", () => {
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(defineWalkthrough({ id: "hint", steps: [{}] }));
    run.requestStart(tour);

    push(record({ tour: progress({ collapsed: false }) }));
    expect(run.getSnapshot().open?.walkthrough.id).toBe("hint");
    expect(progressOf(run)).toMatchObject({ status: "running", collapsed: true });
  });

  it("keeps its own change over an older one heard", () => {
    fakeTimers(2_000);
    const { storage, push } = elsewhere();
    const run = connected({ storage });
    run.start(tour);
    run.act("exit");

    push(record({ tour: progress({ changedAt: 1_000 }) }));
    expect(progressOf(run)?.status).toBe("exited");
  });

  it("keeps what another tab saved through localStorage, though this tab never heard it", () => {
    const key = localKey("waymark");
    const first = connected({ storage: key });
    const second = connected({ storage: key });
    first.start(tour);
    first.act("advance");
    first.act("advance");
    first.act("advance");

    second.start(defineWalkthrough({ id: "hint", steps: [{}] }));
    const stored = JSON.parse(localStorage.getItem(key)!) as StoredRecord;
    expect(stored.walkthroughs["tour"]?.status).toBe("finished");
    expect(stored.walkthroughs["hint"]?.status).toBe("running");
  });

  it("gives a server snapshot from before storage was read", () => {
    const stored = progress();
    const run = connected({ storage: held(record({ tour: stored })) });
    expect(run.getSnapshot()).toMatchObject({ storageStatus: "ready", progress: { tour: stored } });
    expect(run.getServerSnapshot()).toEqual({ storageStatus: "loading", progress: {}, open: null, beacons: [] });

    // Nothing to read: the server shows what the client will.
    const plain = createRun({ initial: record({ tour: stored }) });
    expect(plain.getServerSnapshot()).toBe(plain.getSnapshot());
  });

  it("gives a server snapshot of the record it was given, not what it heard or did since, the same object each time", () => {
    const given = progress();
    const initial = record({ tour: given });
    const { storage, push } = elsewhere(record({ tour: progress({ status: "finished" }) }));
    const run = connected({ storage, initial });
    push(record({ tour: progress({ status: "exited" }) }));
    run.start(defineWalkthrough({ id: "hint", steps: [{}] }));
    expect(run.getSnapshot().progress).toMatchObject({ tour: { status: "exited" }, hint: { status: "running" } });

    expect(run.getServerSnapshot()).toEqual({ storageStatus: "ready", progress: { tour: given }, open: null, beacons: [] });
    expect(run.getServerSnapshot()).toEqual(createRun({ initial }).getSnapshot());
    expect(run.getServerSnapshot()).toBe(run.getServerSnapshot());
  });

  it("reads nothing until it connects, and holds its commands till the record is in", () => {
    const storage = held(record({}, { met: "done" }));
    const run = createRun({ storage });
    run.start(tour);
    expect(storage.load).not.toHaveBeenCalled();
    expect(run.getSnapshot()).toMatchObject({ storageStatus: "loading", progress: {} });

    onTestFinished(run.connect());
    expect(storage.load).toHaveBeenCalledOnce();
    expect(progressOf(run)?.status).toBe("running");
    expect(storage.stored()).toMatchObject({ tasks: { met: "done" }, walkthroughs: { tour: { status: "running" } } });
  });

  it("hears storage while a connection is open, and loads only once", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const storage = { ...held(null), subscribe };
    const run = createRun({ storage });

    const first = run.connect();
    const second = run.connect();
    expect(subscribe).toHaveBeenCalledOnce();
    first();
    first();
    expect(unsubscribe).not.toHaveBeenCalled();
    second();
    expect(unsubscribe).toHaveBeenCalledOnce();

    onTestFinished(run.connect());
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(storage.load).toHaveBeenCalledOnce();
  });

  it("hears storage only once the record is in, and not at all if it disconnected first", async () => {
    const subscribe = vi.fn(() => () => {});
    const storage = later();
    const run = createRun({ storage: { ...storage.adapter, subscribe } });
    run.connect()();
    await storage.answer(null);
    expect(subscribe).not.toHaveBeenCalled();

    const waiting = later();
    const next = createRun({ storage: { ...waiting.adapter, subscribe } });
    onTestFinished(next.connect());
    expect(subscribe).not.toHaveBeenCalled();
    await waiting.answer(null);
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("starts from a record given it, and hears storage, without loading, once it connects", () => {
    const subscribe = vi.fn(() => () => {});
    const storage = { ...held(null), subscribe };
    const run = createRun({ storage, initial: record({}, { met: "done" }) });
    expect(subscribe).not.toHaveBeenCalled();
    onTestFinished(run.connect());
    expect(subscribe).toHaveBeenCalledOnce();
    expect(storage.load).not.toHaveBeenCalled();
  });

  it("keeps a finished walkthrough finished across a reload through localStorage", () => {
    const key = localKey("waymark");
    const first = connected({ storage: key });
    first.start(tour);
    first.act("advance");
    first.act("advance");
    first.act("advance");

    const reloaded = connected({ storage: key });
    reloaded.requestStart(tour);
    expect(reloaded.getSnapshot().open).toBeNull();
    expect(progressOf(reloaded)?.status).toBe("finished");
  });

  it("reads each user's own record, and leaves the last user's alone", () => {
    const ada = localKey("waymark:ada");
    const grace = localKey("waymark:grace");
    connected({ storage: ada }).start(tour);

    const next = connected({ storage: grace });
    expect(next.getSnapshot().progress).toEqual({});
    next.start(defineWalkthrough({ id: "hint", steps: [{}] }));
    expect(Object.keys((JSON.parse(localStorage.getItem(ada)!) as StoredRecord).walkthroughs)).toEqual(["tour"]);
  });
});
