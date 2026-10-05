import { afterEach, describe, expect, it, vi } from "vitest";
import { createChecklists } from "./checklists";
import type { ChecklistsStorage } from "./types";
import type { StorageAdapter } from "../storage/adapter";
import type { StoredChecklistWalkthrough, StoredTasks } from "../storage/records";
import { defineWalkthrough } from "../walkthrough/walkthrough";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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
  onStorageError?: (error: unknown, record: "tasks" | "walkthrough") => void;
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

const statuses = (owner: ReturnType<typeof create>) =>
  Object.fromEntries(owner.checklists.home.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

const events = (onEvent: { mock: { calls: unknown[][] } }) =>
  onEvent.mock.calls.map(([event]) => {
    const { type, task } = event as { type: string; task?: { id: string } };
    return task ? `${type}:${task.id}` : type;
  });

describe("checklists storage: task statuses", () => {
  it("reads a synchronous adapter at creation, with no loading state", () => {
    const tasks = held(saved({ hello: "done" }));
    const owner = create({ storage: { tasks } });
    expect(owner.getSnapshot().storageStatus).toBe("ready");
    expect(owner.checklists.home.getSnapshot().storageStatus).toBe("ready");
    expect(statuses(owner)).toMatchObject({ hello: "done", invite: "todo" });
  });

  it("saves each change, and clears the adapter when nothing is left", () => {
    const tasks = held<StoredTasks>(null);
    const onChange = vi.fn();
    const owner = create({ storage: { tasks }, onChange });
    owner.markDone("hello");
    expect(tasks.save).toHaveBeenLastCalledWith(saved({ hello: "done" }));
    expect(onChange).toHaveBeenLastCalledWith(saved({ hello: "done" }));

    owner.markTodo("hello");
    expect(tasks.save).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenLastCalledWith(saved({}));
  });

  it("is loading until a Promise settles, then shows the statuses without announcing them", async () => {
    const { adapter, answer } = later(saved({ hello: "done", invite: "skipped" }));
    const onEvent = vi.fn();
    const owner = create({ storage: { tasks: adapter }, onEvent });
    const listener = vi.fn();
    owner.checklists.home.subscribe(listener);
    expect(owner.getSnapshot().storageStatus).toBe("loading");
    expect(statuses(owner)).toMatchObject({ hello: "todo", invite: "todo" });

    await answer();

    expect(owner.getSnapshot().storageStatus).toBe("ready");
    expect(statuses(owner)).toMatchObject({ hello: "done", invite: "skipped" });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ storageStatus: "ready", finishedCount: 2 }),
    );
    expect(onEvent).not.toHaveBeenCalled();
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("holds commands while loading and runs them on the stored statuses, in order", async () => {
    const { adapter, answer } = later(saved({ hello: "done", invite: "done" }));
    const onEvent = vi.fn();
    const owner = create({ storage: { tasks: adapter }, onEvent });

    // On the empty record these would skip `hello` and leave `invite` done.
    owner.skip("hello");
    owner.markTodo("invite");
    owner.checklists.home.toggle("met");
    expect(statuses(owner)).toMatchObject({ hello: "todo", invite: "todo", met: "todo" });
    expect(adapter.save).not.toHaveBeenCalled();

    await answer();

    expect(statuses(owner)).toMatchObject({ hello: "done", invite: "todo", met: "done" });
    expect(events(onEvent)).toEqual(["taskReopened:invite", "taskComplete:met"]);
    expect(adapter.save).toHaveBeenLastCalledWith(saved({ hello: "done", met: "done" }));
  });

  it("holds a start, so a tour started on page load only shows if its Task is still todo", async () => {
    const { adapter, answer } = later(saved({}));
    const owner = create({ storage: { tasks: adapter } });
    owner.start("tour");
    expect(owner.getSnapshot().active).toBeNull();

    await answer();
    expect(owner.getSnapshot().active?.task.id).toBe("tour");
  });

  it("checks the latest context once the statuses are in, not before", async () => {
    const { adapter, answer } = later(saved({}));
    const onEvent = vi.fn();
    const owner = create({ storage: { tasks: adapter }, onEvent });
    owner.update({ met: true });
    expect(statuses(owner)).toMatchObject({ met: "todo" });

    await answer();
    expect(statuses(owner)).toMatchObject({ met: "done" });
    expect(onEvent).not.toHaveBeenCalled();
    expect(adapter.save).toHaveBeenCalledExactlyOnceWith(saved({ met: "done" }));
  });

  it("settles `ready` once the statuses are in, whether or not they could be read", async () => {
    const reading = later(saved({ hello: "done" }));
    const owner = create({ storage: { tasks: reading.adapter } });
    const settled = vi.fn();
    void owner.ready.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    await reading.answer();
    await owner.ready;
    expect(statuses(owner)).toMatchObject({ hello: "done" });

    const failing = later<StoredTasks>();
    const broken = create({ storage: { tasks: failing.adapter }, onStorageError: () => {} });
    await failing.refuse(new Error("offline"));
    await expect(broken.ready).resolves.toBeUndefined();
  });

  it("reports a failed load, starts empty with an error status, and saves nothing", async () => {
    const { adapter, refuse } = later<StoredTasks>();
    const onStorageError = vi.fn();
    const owner = create({ storage: { tasks: adapter }, onStorageError });
    const offline = new Error("offline");

    await refuse(offline);

    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(offline, "tasks");
    expect(owner.getSnapshot().storageStatus).toBe("error");
    expect(owner.checklists.home.getSnapshot().storageStatus).toBe("error");
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("saves no condition over a record it cannot read, until the user changes something", () => {
    const tasks = held({ version: 4, tasks: { hello: "done" } } as unknown as StoredTasks);
    const owner = create({ storage: { tasks }, onStorageError: () => {}, context: { met: true } });
    owner.update({ met: true });
    expect(statuses(owner)).toMatchObject({ met: "done" });
    expect(tasks.save).not.toHaveBeenCalled();

    owner.markDone("invite");
    expect(tasks.save).toHaveBeenLastCalledWith(saved({ met: "done", invite: "done" }));
  });

  it("reports a record it cannot read, naming a newer version, without overwriting it", () => {
    const onStorageError = vi.fn();
    const tasks = held({ version: 4, tasks: {} } as unknown as StoredTasks);
    const owner = create({ storage: { tasks }, onStorageError });
    expect(owner.getSnapshot().storageStatus).toBe("error");
    expect(String(onStorageError.mock.calls[0]?.[0])).toMatch(/version 4.*reads up to 3/);
    expect(tasks.save).not.toHaveBeenCalled();

    for (const value of ["text", [], { version: 3 }, { version: 3, tasks: { a: "finished" } }]) {
      onStorageError.mockClear();
      create({ storage: { tasks: held(value as unknown as StoredTasks) }, onStorageError });
      expect(String(onStorageError.mock.calls[0]?.[0])).toMatch(/not one Waymark wrote/);
    }
  });

  it("logs storage failures when given no handler", () => {
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
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("tasks"), blocked);
  });

  it("reports a save that throws or rejects, and carries on", async () => {
    const onStorageError = vi.fn();
    const quota = new Error("quota");
    const owner = create({
      storage: { tasks: { load: () => null, save: () => Promise.reject(quota) } },
      onStorageError,
    });
    owner.markDone("hello");
    await Promise.resolve();
    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(quota, "tasks");

    const thrower = create({
      storage: {
        tasks: {
          load: () => null,
          save: () => {
            throw quota;
          },
        },
      },
      onStorageError,
    });
    expect(() => thrower.markDone("hello")).not.toThrow();
    expect(statuses(thrower)).toMatchObject({ hello: "done" });
    expect(onStorageError).toHaveBeenCalledTimes(2);
  });

  it("reads the version 2 envelope the old localStorage record wrote", () => {
    localStorage.setItem("app", JSON.stringify({ version: 2, record: { hello: "skipped" } }));
    const owner = create({ storage: { tasks: "app" } });
    expect(statuses(owner)).toMatchObject({ hello: "skipped" });
    owner.markDone("invite");
    expect(JSON.parse(localStorage.getItem("app")!)).toEqual(
      saved({ hello: "skipped", invite: "done" }),
    );
  });

  it("takes `initial` in place of loading, and still saves", () => {
    const tasks = held(saved({ hello: "done" }));
    const owner = create({ storage: { tasks }, initial: saved({ invite: "skipped" }) });
    expect(tasks.load).not.toHaveBeenCalled();
    expect(statuses(owner)).toMatchObject({ hello: "todo", invite: "skipped" });
    owner.markDone("hello");
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
    const owner = create({ storage: { tasks }, onEvent });

    push(saved({ hello: "done" }));
    expect(statuses(owner)).toMatchObject({ hello: "done" });
    push(null);
    expect(statuses(owner)).toMatchObject({ hello: "todo" });
    expect(tasks.save).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("follows another tab through a localStorage key", () => {
    const owner = create({ storage: { tasks: "app" } });
    const other = JSON.stringify(saved({ invite: "done" }));
    localStorage.setItem("app", other);
    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "app", newValue: other, storageArea: localStorage }),
    );
    expect(statuses(owner)).toMatchObject({ invite: "done" });

    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "elsewhere", newValue: "{}", storageArea: localStorage }),
    );
    expect(statuses(owner)).toMatchObject({ invite: "done" });
  });

  it("gives a server snapshot from before storage was read", () => {
    const tasks = held(saved({ hello: "done" }));
    const owner = create({ storage: { tasks }, context: { met: true } });
    const view = owner.checklists.home;
    expect(view.getSnapshot()).toMatchObject({ storageStatus: "ready", finishedCount: 2 });
    expect(view.getServerSnapshot()).toMatchObject({ storageStatus: "loading", finishedCount: 0 });
    expect(owner.getServerSnapshot()).toEqual({ active: null, storageStatus: "loading" });

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

  const step = (owner: ReturnType<typeof create>) => {
    const snapshot = owner.getSnapshot().active?.run.getSnapshot();
    return snapshot?.phase === "running"
      ? { step: snapshot.stepIndex, collapsed: snapshot.collapsed }
      : snapshot?.phase;
  };

  it("saves where the walkthrough is as it starts, moves, collapses and stops", () => {
    vi.useFakeTimers({ now: 1_000 });
    const walkthrough = held<StoredChecklistWalkthrough>(null);
    const owner = create({ storage: { walkthrough } });

    owner.checklists.side.start("tour");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      record({ step: 0, collapsed: false, from: "side", savedAt: 1_000 }),
    );
    const run = owner.getSnapshot().active!.run;
    run.act("advance");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      record({ step: 1, collapsed: false, from: "side", savedAt: 1_000 }),
    );
    run.act("collapse");
    expect(walkthrough.save).toHaveBeenLastCalledWith(
      record({ step: 1, from: "side", savedAt: 1_000 }),
    );
    expect(walkthrough.save).toHaveBeenCalledTimes(3);

    owner.stop();
    expect(walkthrough.save).toHaveBeenLastCalledWith(null);
  });

  it("keeps it under a localStorage key, picked up by the next owner", () => {
    create({ storage: { walkthrough: "place" } }).start("tour");
    expect(JSON.parse(localStorage.getItem("place")!)).toMatchObject({ task: "tour", step: 0 });

    const reloaded = create({ storage: { walkthrough: "place" } });
    expect(reloaded.getSnapshot().active?.task.id).toBe("tour");
  });

  it("wipes it as the walkthrough finishes", () => {
    const walkthrough = held<StoredChecklistWalkthrough>(null);
    const owner = create({ storage: { walkthrough } });
    owner.start("tour");
    const run = owner.getSnapshot().active!.run;
    run.act("advance");
    run.act("advance");
    run.act("advance");
    expect(statuses(owner)).toMatchObject({ tour: "done" });
    expect(walkthrough.save).toHaveBeenLastCalledWith(null);
  });

  it("picks the walkthrough up where it was, without announcing a start or saving", () => {
    const onEvent = vi.fn();
    const walkthrough = held(record({ from: "side" }));
    const owner = create({ storage: { walkthrough }, onEvent });

    expect(owner.getSnapshot().active?.task.id).toBe("tour");
    expect(step(owner)).toEqual({ step: 1, collapsed: true });
    expect(onEvent).not.toHaveBeenCalled();
    expect(walkthrough.save).not.toHaveBeenCalled();

    // Its skip still counts toward the checklist that started it.
    owner.skip("tour");
    const skipped = onEvent.mock.calls
      .map(([event]) => event as { type: string; checklist?: string })
      .find((event) => event.type === "taskSkipped");
    expect(skipped?.checklist).toBe("side");
  });

  it.each([
    ["its Task is gone", record({ task: "removed" })],
    ["its Task has no walkthrough", record({ task: "hello" })],
    ["the walkthrough's steps changed", record({ stepCount: 4 })],
    ["it is older than maxAge", record({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })],
  ])("wipes it rather than restore it when %s", (_, stored) => {
    const walkthrough = held(stored);
    const owner = create({ storage: { walkthrough } });
    expect(owner.getSnapshot().active).toBeNull();
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("restores nothing for a Task the statuses say is no longer todo", () => {
    const walkthrough = held(record());
    const owner = create({ storage: { tasks: held(saved({ tour: "skipped" })), walkthrough } });
    expect(owner.getSnapshot().active).toBeNull();
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("honours a custom maxAge", () => {
    const walkthrough = held(record({ savedAt: Date.now() - 60_000 }));
    const owner = create({ storage: { walkthrough, maxAge: 30_000 } });
    expect(owner.getSnapshot().active).toBeNull();
  });

  it("reports a record it cannot read, and wipes it", () => {
    const onStorageError = vi.fn();
    const walkthrough = held({ version: 1, task: "tour", step: 5, stepCount: 3 } as unknown as StoredChecklistWalkthrough);
    create({ storage: { walkthrough }, onStorageError });
    expect(onStorageError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), "walkthrough");
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("waits for the statuses before restoring, which win", async () => {
    const tasks = later(saved({ tour: "done" }));
    const walkthrough = held(record());
    const owner = create({ storage: { tasks: tasks.adapter, walkthrough } });
    expect(owner.getSnapshot().active).toBeNull();

    await tasks.answer();
    expect(owner.getSnapshot().active).toBeNull();
    expect(walkthrough.save).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("does not send start again for the walkthrough it picks up", () => {
    const onRunEvent = vi.fn();
    const owner = create({ storage: { walkthrough: held(record()) }, run: { onEvent: onRunEvent } });
    owner.getSnapshot().active!.run.subscribe(() => {});
    expect(onRunEvent).not.toHaveBeenCalled();

    owner.stop();
    owner.start("tour");
    owner.getSnapshot().active!.run.subscribe(() => {});
    expect(onRunEvent.mock.calls.map(([event]) => (event as { type: string }).type)).toEqual(["exit", "start"]);
  });

  it("does not bring back a walkthrough started and stopped while the statuses loaded", async () => {
    const tasks = later(saved({}));
    const walkthrough = held(record());
    const owner = create({ storage: { tasks: tasks.adapter, walkthrough } });
    owner.start("tour");
    owner.stop();

    await tasks.answer();
    expect(owner.getSnapshot().active).toBeNull();
  });

  it("does not bring back a walkthrough the user stopped before the record arrived", async () => {
    const { adapter, answer } = later(record());
    const owner = create({ storage: { walkthrough: adapter } });
    owner.start("tour");
    owner.stop();

    await answer();
    expect(owner.getSnapshot().active).toBeNull();
    expect(adapter.save).toHaveBeenLastCalledWith(null);
  });

  it("lets a walkthrough started before the record arrives win", async () => {
    const { adapter, answer } = later(record());
    const owner = create({ storage: { walkthrough: adapter } });
    owner.start("tour");
    await answer();
    expect(step(owner)).toEqual({ step: 0, collapsed: false });
  });
});
