import { describe, expect, it, vi } from "vitest";
import { createChecklists } from "./checklists";
import type { ChecklistsStorage } from "./types";
import type { StorageAdapter } from "../storage/adapter";
import type { StoredChecklistWalkthrough, StoredTasks } from "../storage/records";
import { everyProblem } from "../problems";
import type { ProblemHandlers } from "../problems";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import { localKey } from "../test/dom";
import { fakeTimers } from "../test/time";

const tour = defineWalkthrough([{}, {}, {}]);

const saved = (tasks: StoredTasks["tasks"]): StoredTasks => ({ version: 3, tasks });

/** An adapter whose `load` answers when the test says so. */
function later<T>(value: T | null = null) {
  let answer: (value: T | null) => void = () => {};
  let refuse: (error: unknown) => void = () => {};
  const adapter = {
    load: vi.fn(
      () =>
        new Promise<T | null>((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    ),
    save: vi.fn<(value: T | null) => void>(),
  } satisfies StorageAdapter<T>;
  return {
    adapter,
    answer: async (given: T | null = value) => {
      answer(given);
      await Promise.resolve();
    },
    refuse: async (error: unknown) => {
      refuse(error);
      await Promise.resolve();
    },
  };
}

function held<T>(value: T | null) {
  return {
    load: vi.fn(() => value),
    save: vi.fn<(value: T | null) => void>(),
  } satisfies StorageAdapter<T>;
}

type Options = Readonly<{
  storage?: ChecklistsStorage;
  initial?: StoredTasks;
  onChange?: (stored: StoredTasks) => void;
  onEvent?: (event: { type: string }) => void;
  problemHandlers?: ProblemHandlers;
  context?: { met: boolean };
  run?: { onEvent?: (event: { type: string }) => void };
}>;

const create = (options: Options = {}) =>
  createChecklists({
    // Cast so the loosely typed handlers do not take part in inference.
    ...(options as {}),
    context: options.context ?? { met: false },
    tasks: {
      tour: { walkthrough: tour },
      hello: {},
      invite: {},
      met: { isComplete: (context: { met: boolean }) => context.met },
    },
    checklists: { home: ["tour", "hello", "invite", "met"], side: ["tour"] },
  });

const statuses = (controller: ReturnType<typeof create>) =>
  Object.fromEntries(controller.checklists.home.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

const events = (onEvent: { mock: { calls: unknown[][] } }) =>
  onEvent.mock.calls.map(([event]) => {
    const { type, task } = event as { type: string; task?: { id: string } };
    return task ? `${type}:${task.id}` : type;
  });

describe("checklists storage: task statuses", () => {
  it("reads a synchronous adapter at creation, with no loading state", () => {
    const tasks = held(saved({ hello: "done" }));
    const controller = create({ storage: { tasks } });
    expect(controller.getSnapshot().storageStatus).toBe("ready");
    expect(controller.checklists.home.getSnapshot().storageStatus).toBe("ready");
    expect(statuses(controller)).toMatchObject({ hello: "done", invite: "todo" });
  });

  it("saves each change, and clears the adapter when nothing is left", () => {
    const tasks = held<StoredTasks>(null);
    const onChange = vi.fn();
    const controller = create({ storage: { tasks }, onChange });
    controller.markDone("hello");
    expect(tasks.save).toHaveBeenLastCalledWith(saved({ hello: "done" }));
    expect(onChange).toHaveBeenLastCalledWith(saved({ hello: "done" }));

    controller.markTodo("hello");
    expect(tasks.save).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenLastCalledWith(saved({}));
  });

  it("is loading until a Promise settles, then shows the statuses without announcing them", async () => {
    const { adapter, answer } = later(saved({ hello: "done", invite: "skipped" }));
    const onEvent = vi.fn();
    const controller = create({ storage: { tasks: adapter }, onEvent });
    const listener = vi.fn();
    controller.checklists.home.subscribe(listener);
    expect(controller.getSnapshot().storageStatus).toBe("loading");
    expect(statuses(controller)).toMatchObject({ hello: "todo", invite: "todo" });

    await answer();

    expect(controller.getSnapshot().storageStatus).toBe("ready");
    expect(statuses(controller)).toMatchObject({ hello: "done", invite: "skipped" });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ storageStatus: "ready", finishedCount: 2 }),
    );
    expect(onEvent).not.toHaveBeenCalled();
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("holds commands while loading and runs them on the stored statuses, in order", async () => {
    const { adapter, answer } = later(saved({ hello: "done", invite: "done" }));
    const onEvent = vi.fn();
    const controller = create({ storage: { tasks: adapter }, onEvent });

    // On the empty record these would skip `hello` and leave `invite` done.
    controller.skip("hello");
    controller.markTodo("invite");
    controller.checklists.home.toggle("met");
    expect(statuses(controller)).toMatchObject({ hello: "todo", invite: "todo", met: "todo" });
    expect(adapter.save).not.toHaveBeenCalled();

    await answer();

    expect(statuses(controller)).toMatchObject({ hello: "done", invite: "todo", met: "done" });
    expect(events(onEvent)).toEqual(["taskReopened:invite", "taskComplete:met"]);
    expect(adapter.save).toHaveBeenLastCalledWith(saved({ hello: "done", met: "done" }));
  });

  it("holds a start, so a tour started on page load only shows if its Task is still todo", async () => {
    const { adapter, answer } = later(saved({}));
    const controller = create({ storage: { tasks: adapter } });
    controller.start("tour");
    expect(controller.getSnapshot().active).toBeNull();

    await answer();
    expect(controller.getSnapshot().active?.task.id).toBe("tour");
  });

  it("checks the latest context once the statuses are in, not before", async () => {
    const { adapter, answer } = later(saved({}));
    const onEvent = vi.fn();
    const controller = create({ storage: { tasks: adapter }, onEvent });
    controller.update({ met: true });
    expect(statuses(controller)).toMatchObject({ met: "todo" });

    await answer();
    expect(statuses(controller)).toMatchObject({ met: "done" });
    expect(onEvent).not.toHaveBeenCalled();
    expect(adapter.save).toHaveBeenCalledExactlyOnceWith(saved({ met: "done" }));
  });

  it("settles `ready` once the statuses are in, whether or not they could be read", async () => {
    const reading = later(saved({ hello: "done" }));
    const controller = create({ storage: { tasks: reading.adapter } });
    const settled = vi.fn();
    void controller.ready.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    await reading.answer();
    await controller.ready;
    expect(statuses(controller)).toMatchObject({ hello: "done" });

    const failing = later<StoredTasks>();
    const broken = create({ storage: { tasks: failing.adapter }, problemHandlers: { storageFailed: () => {} } });
    await failing.refuse(new Error("offline"));
    await expect(broken.ready).resolves.toBeUndefined();
  });

  it("reports a failed load, starts empty with an error status, and saves nothing", async () => {
    const { adapter, refuse } = later<StoredTasks>();
    const onProblem = vi.fn();
    const controller = create({ storage: { tasks: adapter }, problemHandlers: everyProblem(onProblem) });
    const offline = new Error("offline");

    await refuse(offline);

    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "storageFailed", record: "tasks", error: offline });
    expect(controller.getSnapshot().storageStatus).toBe("error");
    expect(controller.checklists.home.getSnapshot().storageStatus).toBe("error");
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("saves no condition over a record it cannot read, until the user changes something", () => {
    const tasks = held({ version: 4, tasks: { hello: "done" } } as unknown as StoredTasks);
    const controller = create({ storage: { tasks }, problemHandlers: { recordUnreadable: () => {} }, context: { met: true } });
    controller.update({ met: true });
    expect(statuses(controller)).toMatchObject({ met: "done" });
    expect(tasks.save).not.toHaveBeenCalled();

    controller.markDone("invite");
    expect(tasks.save).toHaveBeenLastCalledWith(saved({ met: "done", invite: "done" }));
  });

  it("reports a record it cannot read, naming a newer version, without overwriting it", () => {
    const onProblem = vi.fn();
    const tasks = held({ version: 4, tasks: {} } as unknown as StoredTasks);
    const controller = create({ storage: { tasks }, problemHandlers: everyProblem(onProblem) });
    expect(controller.getSnapshot().storageStatus).toBe("error");
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "recordUnreadable",
      record: "tasks",
      error: expect.objectContaining({ message: expect.stringMatching(/version 4.*reads up to 3/) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    });
    expect(tasks.save).not.toHaveBeenCalled();

    for (const value of ["text", [], { version: 3 }, { version: 3, tasks: { a: "finished" } }]) {
      onProblem.mockClear();
      create({ storage: { tasks: held(value as unknown as StoredTasks) }, problemHandlers: everyProblem(onProblem) });
      expect(onProblem).toHaveBeenCalledExactlyOnceWith({
        type: "recordUnreadable",
        record: "tasks",
        error: expect.objectContaining({ message: expect.stringMatching(/not one Waymark wrote/) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      });
    }
  });

  it.each<[string, Options]>([
    ["no handlers", {}],
    ["handlers for other problems", { problemHandlers: { waymarkMissing: () => {} } }],
  ])("logs storage failures when given %s", (_, handlers) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked = new Error("blocked");
    create({
      storage: {
        tasks: {
          load: () => {
            throw blocked;
          },
          save: () => {},
        },
      },
      ...handlers,
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("tasks"), blocked);
  });

  it("reports a save that throws or rejects, and carries on", async () => {
    const onProblem = vi.fn();
    const quota = new Error("quota");
    const controller = create({
      storage: { tasks: { load: () => null, save: () => Promise.reject(quota) } },
      problemHandlers: everyProblem(onProblem),
    });
    controller.markDone("hello");
    await Promise.resolve();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "storageFailed", record: "tasks", error: quota });

    const thrower = create({
      storage: {
        tasks: {
          load: () => null,
          save: () => {
            throw quota;
          },
        },
      },
      problemHandlers: everyProblem(onProblem),
    });
    expect(() => thrower.markDone("hello")).not.toThrow();
    expect(statuses(thrower)).toMatchObject({ hello: "done" });
    expect(onProblem).toHaveBeenCalledTimes(2);
  });

  it("reads the version 2 envelope the old localStorage record wrote", () => {
    const key = localKey("app");
    localStorage.setItem(key, JSON.stringify({ version: 2, record: { hello: "skipped" } }));
    const controller = create({ storage: { tasks: key } });
    expect(statuses(controller)).toMatchObject({ hello: "skipped" });
    controller.markDone("invite");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(
      saved({ hello: "skipped", invite: "done" }),
    );
  });

  it("takes `initial` in place of loading, and still saves", () => {
    const tasks = held(saved({ hello: "done" }));
    const controller = create({ storage: { tasks }, initial: saved({ invite: "skipped" }) });
    expect(tasks.load).not.toHaveBeenCalled();
    expect(statuses(controller)).toMatchObject({ hello: "todo", invite: "skipped" });
    controller.markDone("hello");
    expect(tasks.save).toHaveBeenLastCalledWith(saved({ hello: "done", invite: "skipped" }));
  });

  it("takes changes made elsewhere through `subscribe`, without saving them back", () => {
    let push: (value: StoredTasks | null) => void = () => {};
    const tasks = {
      load: () => saved({}),
      save: vi.fn(),
      subscribe: (listener: (value: StoredTasks | null) => void) => {
        push = listener;
        return () => {};
      },
    };
    const onEvent = vi.fn();
    const controller = create({ storage: { tasks }, onEvent });

    push(saved({ hello: "done" }));
    expect(statuses(controller)).toMatchObject({ hello: "done" });
    push(null);
    expect(statuses(controller)).toMatchObject({ hello: "todo" });
    expect(tasks.save).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("follows another tab through a localStorage key", () => {
    const key = localKey("app");
    const controller = create({ storage: { tasks: key } });
    const other = JSON.stringify(saved({ invite: "done" }));
    localStorage.setItem(key, other);
    globalThis.dispatchEvent(
      new StorageEvent("storage", { key, newValue: other, storageArea: localStorage }),
    );
    expect(statuses(controller)).toMatchObject({ invite: "done" });

    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "elsewhere", newValue: "{}", storageArea: localStorage }),
    );
    expect(statuses(controller)).toMatchObject({ invite: "done" });
  });

  it("gives a server snapshot from before storage was read", () => {
    const tasks = held(saved({ hello: "done" }));
    const controller = create({ storage: { tasks }, context: { met: true } });
    const view = controller.checklists.home;
    expect(view.getSnapshot()).toMatchObject({ storageStatus: "ready", finishedCount: 2 });
    expect(view.getServerSnapshot()).toMatchObject({ storageStatus: "loading", finishedCount: 0 });
    expect(controller.getServerSnapshot()).toEqual({ active: null, storageStatus: "loading" });

    // Nothing to read: the server shows what the client will.
    const plain = create({ initial: saved({ hello: "done" }), context: { met: true } });
    expect(plain.checklists.home.getServerSnapshot()).toBe(plain.checklists.home.getSnapshot());
  });
});

describe("checklists storage: the walkthrough", () => {
  const record = (overrides: Partial<StoredChecklistWalkthrough> = {}): StoredChecklistWalkthrough => ({
    version: 1,
    task: "tour",
    step: 1,
    stepCount: 3,
    collapsed: true,
    savedAt: Date.now(),
    ...overrides,
  });

  const step = (controller: ReturnType<typeof create>) => {
    const snapshot = controller.getSnapshot().active?.run.getSnapshot();
    return snapshot?.phase === "running"
      ? { step: snapshot.stepIndex, collapsed: snapshot.collapsed }
      : snapshot?.phase;
  };

  it("saves where the walkthrough is as it starts, moves, collapses and stops", () => {
    fakeTimers(1_000);
    const walkthrough = held<StoredChecklistWalkthrough>(null);
    const controller = create({ storage: { walkthrough } });

    controller.checklists.side.start("tour");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      record({ step: 0, collapsed: false, from: "side", savedAt: 1_000 }),
    );
    const run = controller.getSnapshot().active!.run;
    run.act("advance");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      record({ step: 1, collapsed: false, from: "side", savedAt: 1_000 }),
    );
    run.act("collapse");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      record({ step: 1, from: "side", savedAt: 1_000 }),
    );
    expect(walkthrough.save).toHaveBeenCalledTimes(3);

    controller.stop();
    expect(walkthrough.save).toHaveBeenLastCalledWith(null);
  });

  it("keeps it under a localStorage key, picked up by the next controller", () => {
    const key = localKey("place");
    create({ storage: { walkthrough: key } }).start("tour");
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ task: "tour", step: 0 });

    const reloaded = create({ storage: { walkthrough: key } });
    expect(reloaded.getSnapshot().active?.task.id).toBe("tour");
  });

  it("wipes it as the walkthrough finishes", () => {
    const walkthrough = held<StoredChecklistWalkthrough>(null);
    const controller = create({ storage: { walkthrough } });
    controller.start("tour");
    const run = controller.getSnapshot().active!.run;
    run.act("advance");
    run.act("advance");
    run.act("advance");
    expect(statuses(controller)).toMatchObject({ tour: "done" });
    expect(walkthrough.save).toHaveBeenLastCalledWith(null);
  });

  it("picks the walkthrough up where it was, without announcing a start or saving", () => {
    const onEvent = vi.fn();
    const walkthrough = held(record({ from: "side" }));
    const controller = create({ storage: { walkthrough }, onEvent });

    expect(controller.getSnapshot().active?.task.id).toBe("tour");
    expect(step(controller)).toEqual({ step: 1, collapsed: true });
    expect(onEvent).not.toHaveBeenCalled();
    expect(walkthrough.save).not.toHaveBeenCalled();

    // Its skip still counts toward the checklist that started it.
    controller.skip("tour");
    const skipped = onEvent.mock.calls
      .map(([event]) => event as { type: string; checklist?: string })
      .find((event) => event.type === "taskSkipped");
    expect(skipped?.checklist).toBe("side");
  });

  it.each([
    ["its Task is gone", record({ task: "removed" }), "unknownTask"],
    ["its Task has no walkthrough", record({ task: "hello" }), "unknownTask"],
    ["the walkthrough's steps changed", record({ stepCount: 4 }), "stepsChanged"],
    ["it is older than maxAge", record({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 }), "expired"],
  ])("wipes and reports it rather than restore it when %s", (_, stored, reason) => {
    const walkthrough = held(stored);
    const onProblem = vi.fn();
    const controller = create({ storage: { walkthrough }, problemHandlers: everyProblem(onProblem) });
    expect(controller.getSnapshot().active).toBeNull();
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "recordDropped", record: "walkthrough", reason });
  });

  it("restores nothing for a Task the statuses say is no longer todo", () => {
    const walkthrough = held(record());
    const onProblem = vi.fn();
    const controller = create({ storage: { tasks: held(saved({ tour: "skipped" })), walkthrough }, problemHandlers: everyProblem(onProblem) });
    expect(controller.getSnapshot().active).toBeNull();
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "recordDropped",
      record: "walkthrough",
      reason: "taskNotTodo",
    });
  });

  it("keeps the record of a Task the handler starts on hearing the stored one was dropped", async () => {
    const walkthrough = later(record({ stepCount: 4 }));
    const controller = create({
      storage: { walkthrough: walkthrough.adapter },
      problemHandlers: { recordDropped: () => controller.start("tour") },
    });
    await walkthrough.answer();
    expect(controller.getSnapshot().active?.task.id).toBe("tour");
    expect(walkthrough.adapter.save.mock.lastCall?.[0]?.task).toBe("tour");
  });

  it("honours a custom maxAge", () => {
    const walkthrough = held(record({ savedAt: Date.now() - 60_000 }));
    const controller = create({ storage: { walkthrough, maxAge: 30_000 } });
    expect(controller.getSnapshot().active).toBeNull();
  });

  it("reports a record it cannot read, and wipes it", () => {
    const onProblem = vi.fn();
    const walkthrough = held({ version: 1, task: "tour", step: 5, stepCount: 3 } as unknown as StoredChecklistWalkthrough);
    create({ storage: { walkthrough }, problemHandlers: everyProblem(onProblem) });
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "recordUnreadable",
      record: "walkthrough",
      error: expect.any(Error), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    });
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("waits for the statuses before restoring, which win", async () => {
    const tasks = later(saved({ tour: "done" }));
    const walkthrough = held(record());
    const controller = create({ storage: { tasks: tasks.adapter, walkthrough } });
    expect(controller.getSnapshot().active).toBeNull();

    await tasks.answer();
    expect(controller.getSnapshot().active).toBeNull();
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("does not send start again for the walkthrough it picks up", () => {
    const onRunEvent = vi.fn();
    const controller = create({ storage: { walkthrough: held(record()) }, run: { onEvent: onRunEvent } });
    controller.getSnapshot().active!.run.subscribe(() => {});
    expect(onRunEvent).not.toHaveBeenCalled();

    controller.stop();
    controller.start("tour");
    controller.getSnapshot().active!.run.subscribe(() => {});
    expect(onRunEvent.mock.calls.map(([event]) => (event as { type: string }).type)).toEqual(["exit", "start"]);
  });

  it("does not bring back a walkthrough started and stopped while the statuses loaded", async () => {
    const tasks = later(saved({}));
    const walkthrough = held(record());
    const controller = create({ storage: { tasks: tasks.adapter, walkthrough } });
    controller.start("tour");
    controller.stop();

    await tasks.answer();
    expect(controller.getSnapshot().active).toBeNull();
  });

  it("does not bring back a walkthrough the user stopped before the record arrived", async () => {
    const { adapter, answer } = later(record());
    const controller = create({ storage: { walkthrough: adapter } });
    controller.start("tour");
    controller.stop();

    await answer();
    expect(controller.getSnapshot().active).toBeNull();
    expect(adapter.save).toHaveBeenLastCalledWith(null);
  });

  it("lets a walkthrough started before the record arrives win", async () => {
    const { adapter, answer } = later(record());
    const controller = create({ storage: { walkthrough: adapter } });
    controller.start("tour");
    await answer();
    expect(step(controller)).toEqual({ step: 0, collapsed: false });
  });
});
