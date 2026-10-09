import { describe, expect, it, vi } from "vitest";
import { addToBody } from "../test/dom";
import { skipFirstCall } from "../test/listeners";
import { fakeFrames } from "../test/time";
import { createChecklists } from "./checklists";
import { everyProblem } from "../problems";
import type { StoredTasks } from "../storage/records";
import type { ChecklistSelections, ChecklistsEvent, Task, TaskMap } from "./types";
import { defineWalkthrough } from "../walkthrough/walkthrough";

const guide = defineWalkthrough([{ waymark: "save" }, {}]);
const single = defineWalkthrough([{}]);

const context = { hasDeck: false, hasPhoto: false };
type Context = typeof context;

/** An event from any controller in this file: `Task<never>` accepts a condition on any context. */
type AnyEvent = ChecklistsEvent<TaskMap<never>, ChecklistSelections<TaskMap<never>>>;

/** Task statuses as storage holds them. */
const saved = (tasks: StoredTasks["tasks"]): StoredTasks => ({ version: 3, tasks });

type Options = {
  initial?: StoredTasks;
  onChange?: (stored: StoredTasks) => void;
  onEvent?: (event: AnyEvent) => void;
};

const setup = ({ context: initial = context, ...options }: Options & { context?: Context } = {}) =>
  createChecklists({
    // Cast so the helper's loosely typed handlers do not take part in inference.
    ...(options as {}),
    context: initial,
    tasks: {
      "create-deck": { walkthrough: guide, isComplete: (c) => c.hasDeck },
      "add-photo": { walkthrough: single, isComplete: (c) => c.hasPhoto },
      "read-tips": { walkthrough: single },
      "say-hello": {},
    },
    checklists: {
      home: ["add-photo", "create-deck", "read-tips", "say-hello"],
      decks: ["create-deck"],
    },
  });

const statuses = (view: { getSnapshot: () => { tasks: readonly { task: { id: string }; status: string }[] } }) =>
  Object.fromEntries(view.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

const types = (calls: { mock: { calls: unknown[][] } }) =>
  calls.mock.calls.map(([event]) => {
    const e = event as AnyEvent;
    return "task" in e ? `${e.type}:${e.task.id}` : `${e.type}:${e.checklist}`;
  });

const finish = (run: { act: (action: "advance") => void }, steps: number) => {
  for (let i = 0; i < steps; i++) run.act("advance");
};

describe("createChecklists", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "supports %s as both a task id and checklist name",
    (name) => {
      const onChange = vi.fn<(stored: StoredTasks) => void>();
      const controller = createChecklists({
        context: {},
        tasks: { [name]: { walkthrough: single } },
        checklists: { [name]: [name] },
        onChange,
      });
      const view = controller.checklists[name]!;
      expect(Object.hasOwn(controller.checklists, name)).toBe(true);
      expect(view.getSnapshot().tasks[0]).toMatchObject({ task: { id: name }, status: "todo" });

      view.start(name);
      expect(controller.getSnapshot().active?.task.id).toBe(name);
      view.skip(name);
      expect(view.getSnapshot().tasks[0]!.status).toBe("skipped");
      const stored = onChange.mock.calls[0]![0];
      expect(Object.hasOwn(stored.tasks, name)).toBe(true);
      expect(stored.tasks[name]).toBe("skipped");

      controller.clear();
      controller.load(JSON.parse(JSON.stringify(stored)) as StoredTasks);
      expect(view.getSnapshot().tasks[0]!.status).toBe("skipped");
      view.markDone(name);
      expect(view.getSnapshot().tasks[0]!.status).toBe("done");
      expect(onChange.mock.lastCall![0]).toEqual(saved({ [name]: "done" }));
    },
  );

  it("works without a context", () => {
    const controller = createChecklists({ tasks: { hello: {} }, checklists: { home: ["hello"] } });
    controller.update({});
    controller.checklists.home.markDone("hello");
    expect(controller.checklists.home.getSnapshot().complete).toBe(true);
  });

  it("checks no condition at creation when given no context", () => {
    // Typed for a context it was not given, so a condition must not see a made-up one.
    const controller = createChecklists<{ user: { plan: string } }>({
      tasks: { upgrade: { isComplete: (c) => c.user.plan === "pro" } },
    });
    expect(statuses(controller.checklists.main)).toEqual({ upgrade: "todo" });

    controller.update({ user: { plan: "pro" } });
    expect(statuses(controller.checklists.main)).toEqual({ upgrade: "done" });
  });

  it("has one checklist, main, of every task in order when it names none", () => {
    const onChange = vi.fn();
    const controller = createChecklists({
      tasks: { tour: { walkthrough: single }, hello: {}, invite: {} },
      onChange,
    });
    expect(Object.keys(controller.checklists)).toEqual(["main"]);
    expect(controller.checklists.main.getSnapshot().tasks.map((row) => row.task.id)).toEqual([
      "tour",
      "hello",
      "invite",
    ]);

    controller.checklists.main.skip("hello");
    expect(onChange).toHaveBeenLastCalledWith(saved({ hello: "skipped" }));
  });

  it("rejects definitions it cannot show", () => {
    expect(() => createChecklists({ context: {}, tasks: {}, checklists: { a: [] } })).toThrow(
      /at least one task/,
    );
    expect(() =>
      createChecklists({ context: {}, tasks: { a: {} }, checklists: {} as { a: readonly ["a"] } }),
    ).toThrow(/at least one checklist/);
    expect(() =>
      createChecklists({ context: {}, tasks: { a: {} }, checklists: { home: [] as unknown as ["a"] } }),
    ).toThrow(/selects no tasks/);
    expect(() =>
      createChecklists({ context: {}, tasks: { a: {} }, checklists: { home: ["a", "a"] } }),
    ).toThrow(/repeats task "a"/);
    expect(() =>
      createChecklists({ context: {}, tasks: { a: {} }, checklists: { home: ["b" as "a"] } }),
    ).toThrow(/unknown task "b"/);
    expect(() =>
      createChecklists({ context: {}, tasks: { "": {} }, checklists: { home: [""] } }),
    ).toThrow(/cannot be empty/);
    expect(() =>
      createChecklists({
        context: {},
        tasks: { a: { walkthrough: defineWalkthrough([{}], { storage: "a" }) as never } },
      }),
    ).toThrow(/Task "a": its walkthrough has its own storage/);
    expect(() =>
      createChecklists({
        context: {},
        tasks: { a: { walkthrough: defineWalkthrough([{}], { problemHandlers: { waymarkMissing: () => {} } }) as never } },
      }),
    ).toThrow(/Task "a": its walkthrough has its own problemHandlers/);
  });

  it("shows every task of a selection in its order, with its id and definition", () => {
    const controller = setup();
    const rows = controller.checklists.home.getSnapshot().tasks;
    expect(rows.map((row) => row.task.id)).toEqual(["add-photo", "create-deck", "read-tips", "say-hello"]);
    const deck = rows[1]!.task;
    if (deck.id !== "create-deck") throw new Error("expected create-deck");
    expect(deck.walkthrough).toBe(guide);
    expect(rows[1]!.status).toBe("todo");
    expect(controller.checklists.decks.getSnapshot()).toMatchObject({
      finishedCount: 0,
      taskCount: 1,
      complete: false,
      active: null,
    });
  });

  it("records matching conditions at creation, saving but announcing nothing", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const controller = setup({ context: { hasDeck: true, hasPhoto: false }, onChange, onEvent });
    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "done" });
    expect(controller.checklists.decks.getSnapshot().complete).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "create-deck": "done" }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not save the record it starts from", () => {
    const onChange = vi.fn();
    const controller = setup({ initial: saved({ "read-tips": "done", "say-hello": "skipped" }), onChange });
    expect(onChange).not.toHaveBeenCalled();
    expect(statuses(controller.checklists.home)).toMatchObject({ "read-tips": "done", "say-hello": "skipped" });

    controller.markDone("say-hello");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "read-tips": "done", "say-hello": "done" }));
  });

  it("preserves unknown ids across local changes", () => {
    const onChange = vi.fn();
    const controller = setup({ initial: saved({ zeta: "done", gone: "skipped", old: "reopened" }), onChange });
    controller.checklists.decks.skip("create-deck");
    expect(onChange).toHaveBeenLastCalledWith(saved({
      zeta: "done",
      gone: "skipped",
      old: "reopened",
      "create-deck": "skipped",
    }));
  });
});

describe("update", () => {
  it("records done in every view, once, and announces task then checklist completion", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const controller = setup({ onChange, onEvent });
    const home = vi.fn();
    const decks = vi.fn();
    controller.checklists.home.subscribe(home);
    controller.checklists.decks.subscribe(decks);
    home.mockClear();
    decks.mockClear();

    controller.update({ hasDeck: true, hasPhoto: false });

    expect(statuses(controller.checklists.home)["create-deck"]).toBe("done");
    expect(statuses(controller.checklists.decks)["create-deck"]).toBe("done");
    expect(home).toHaveBeenCalledOnce();
    expect(decks).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "create-deck": "done" }));
    expect(types(onEvent)).toEqual(["taskComplete:create-deck", "checklistComplete:decks"]);
    const complete = onEvent.mock.calls[1]![0] as Extract<AnyEvent, { type: "checklistComplete" }>;
    expect(complete.snapshot).toBe(controller.checklists.decks.getSnapshot());
    expect(complete.snapshot.finishedCount).toBe(1);
  });

  it("checks in task map order and commits everything together", () => {
    const seen: string[] = [];
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const controller = createChecklists({
      context: { ready: false },
      tasks: {
        b: { isComplete: (c) => (seen.push("b"), c.ready) },
        a: { isComplete: (c) => (seen.push("a"), c.ready) },
      },
      checklists: { all: ["a", "b"] },
      initial: saved({ "unknown-task": "done", a: "skipped", "unknown-skipped": "skipped" }),
      onEvent,
      onChange,
    });
    const listener = vi.fn();
    controller.checklists.all.subscribe(listener);
    listener.mockClear();
    seen.length = 0;

    controller.update({ ready: true });
    expect(seen).toEqual(["b", "a"]);
    expect(listener).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({
      "unknown-task": "done",
      a: "done",
      b: "done",
      "unknown-skipped": "skipped",
    }));
    expect(types(onEvent)).toEqual(["taskComplete:b", "taskComplete:a", "checklistComplete:all"]);
  });

  it("leaves done tasks alone and does not re-check them", () => {
    const isComplete = vi.fn((c: { ready: boolean }) => c.ready);
    const controller = createChecklists({
      context: { ready: true },
      tasks: { a: { isComplete } },
      checklists: { all: ["a"] },
    });
    isComplete.mockClear();
    controller.update({ ready: false });
    expect(isComplete).not.toHaveBeenCalled();
    expect(statuses(controller.checklists.all)).toEqual({ a: "done" });
  });

  it("lets done override skipped everywhere without repeating a view's completion", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.checklists.decks.skip("create-deck");
    expect(types(onEvent)).toEqual(["taskSkipped:create-deck", "checklistComplete:decks"]);
    onEvent.mockClear();

    controller.update({ hasDeck: true, hasPhoto: false });
    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "done" });
    expect(types(onEvent)).toEqual(["taskComplete:create-deck"]);
  });

  it("records nothing when a condition throws", () => {
    const controller = createChecklists({
      context: { ready: false },
      tasks: {
        a: { isComplete: (c) => c.ready },
        b: {
          isComplete: (c) => {
            if (c.ready) throw new Error("boom");
            return false;
          },
        },
      },
      checklists: { all: ["a", "b"] },
    });
    expect(() => controller.update({ ready: true })).toThrow("boom");
    expect(statuses(controller.checklists.all)).toEqual({ a: "todo", b: "todo" });
  });

  it("sends a throwing isComplete to problemHandlers instead of throwing, and leaves every task todo", () => {
    const onProblem = vi.fn();
    const boom = new Error("boom");
    const controller = createChecklists({
      context: { ready: false },
      tasks: {
        a: { isComplete: (c) => c.ready },
        b: {
          isComplete: (c) => {
            if (c.ready) throw boom;
            return false;
          },
        },
      },
      checklists: { all: ["a", "b"] },
      problemHandlers: everyProblem(onProblem),
    });
    expect(() => controller.update({ ready: true })).not.toThrow();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "callbackThrew", callback: "isComplete", error: boom });
    expect(statuses(controller.checklists.all)).toEqual({ a: "todo", b: "todo" });
  });

  it("sends errors from subscribers, onChange, onEvent and run.onEvent to problemHandlers, and still applies each change", () => {
    const onProblem = vi.fn();
    const broken = new Error("broken");
    const fail = () => {
      throw broken;
    };
    const controller = createChecklists({
      tasks: { a: { walkthrough: single }, b: {} },
      onChange: fail,
      onEvent: fail,
      run: { onEvent: fail },
      problemHandlers: everyProblem(onProblem),
    });
    controller.checklists.main.subscribe(skipFirstCall(fail));

    expect(() => controller.markDone("b")).not.toThrow();
    expect(() => controller.start("a")).not.toThrow();
    expect(() => controller.getSnapshot().active!.run.act("advance")).not.toThrow();
    expect(statuses(controller.checklists.main)).toEqual({ a: "done", b: "done" });
    const threw = (callback: string) => [{ type: "callbackThrew", callback, error: broken }];
    expect(onProblem.mock.calls).toEqual(
      [
        // markDone("b"); onEvent hears taskComplete
        "subscriber", "onChange", "onEvent",
        // start("a"); onEvent hears taskStarted
        "subscriber", "onEvent",
        // advance; run.onEvent hears advance
        "onEvent",
        // the Run finishes; onEvent hears taskStopped, taskComplete and checklistComplete
        "subscriber", "onChange", "onEvent", "onEvent", "onEvent",
        // run.onEvent hears finish, after the controller has handled it
        "onEvent",
      ].map(threw),
    );
  });

  it("sends an error from a subscriber's first call to problemHandlers", () => {
    const onProblem = vi.fn();
    const broken = new Error("broken");
    const fail = () => {
      throw broken;
    };
    const controller = createChecklists({ tasks: { a: {} }, problemHandlers: everyProblem(onProblem) });
    expect(() => controller.subscribe(fail)).not.toThrow();
    expect(() => controller.checklists.main.subscribe(fail)).not.toThrow();
    const threw = [{ type: "callbackThrew", callback: "subscriber", error: broken }];
    expect(onProblem.mock.calls).toEqual([threw, threw]);
  });

  it("sends a missing waymark in a task's Run to the controller's problemHandlers", () => {
    const { flush } = fakeFrames();
    const onProblem = vi.fn();
    const controller = createChecklists({ tasks: { a: { walkthrough: guide } }, problemHandlers: everyProblem(onProblem) });
    controller.subscribeActive(() => {});
    controller.start("a");
    flush(3000);
    flush();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "waymarkMissing",
      step: { waymark: "save" },
      stepIndex: 0,
    });
  });

  it("keeps an unaffected view's snapshot identity", () => {
    const controller = setup();
    const decksBefore = controller.checklists.decks.getSnapshot();
    const homeBefore = controller.checklists.home.getSnapshot();
    controller.update({ hasDeck: false, hasPhoto: true });
    expect(controller.checklists.decks.getSnapshot()).toBe(decksBefore);
    expect(controller.checklists.home.getSnapshot()).not.toBe(homeBefore);
  });
});

describe("guidance", () => {
  it("starts a Run, shows it in every view holding the task, and exits it on stop", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    const controllerListener = vi.fn();
    controller.subscribe(controllerListener);
    controllerListener.mockClear();
    const before = controller.getSnapshot();

    controller.checklists.decks.start("create-deck");

    const active = controller.getSnapshot().active!;
    expect(active.task.id).toBe("create-deck");
    expect(active.run.getSnapshot()).toMatchObject({ phase: "running", stepIndex: 0 });
    expect(controller.getSnapshot()).not.toBe(before);
    expect(controllerListener).toHaveBeenCalledOnce();
    expect(controller.checklists.home.getSnapshot().active).toBe(active);
    expect(controller.checklists.decks.getSnapshot().active).toBe(active);
    expect(types(onEvent)).toEqual(["taskStarted:create-deck"]);

    controller.start("create-deck");
    expect(controller.getSnapshot().active).toBe(active);
    expect(controllerListener).toHaveBeenCalledOnce();

    controller.stop();
    expect(controller.getSnapshot().active).toBeNull();
    expect(active.run.getSnapshot().phase).toBe("exited");
    expect(types(onEvent)).toEqual(["taskStarted:create-deck", "taskStopped:create-deck"]);
    expect(onEvent.mock.calls[1]![0]).toMatchObject({ reason: "stopped" });

    controller.stop();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("hides the Run from views that do not hold its task", () => {
    const controller = setup();
    controller.start("add-photo");
    expect(controller.checklists.home.getSnapshot().active?.task.id).toBe("add-photo");
    expect(controller.checklists.decks.getSnapshot().active).toBeNull();
  });

  it("runs steps written inline on the task, and shows the task as written", () => {
    const steps = [{ waymark: "save" }, {}] as const;
    const controller = createChecklists({
      context: {},
      tasks: { tour: { walkthrough: steps } },
      checklists: { home: ["tour"] },
    });
    expect(controller.checklists.home.getSnapshot().tasks[0]!.task.walkthrough).toBe(steps);

    controller.start("tour");
    const { run } = controller.getSnapshot().active!;
    expect(run.getSnapshot()).toMatchObject({ phase: "running", stepCount: 2 });
    finish(run, 2);
    expect(statuses(controller.checklists.home)).toEqual({ tour: "done" });
  });

  it("checks inline steps at creation, naming the task", () => {
    expect(() =>
      createChecklists({ context: {}, tasks: { tour: { walkthrough: [] } }, checklists: { home: ["tour"] } }),
    ).toThrow('Task "tour": A walkthrough needs at least one step.');
    expect(() =>
      createChecklists({
        context: {},
        tasks: { tour: { walkthrough: [{}, { waymark: "a", selector: "#a" }] } },
        checklists: { home: ["tour"] },
      }),
    ).toThrow(/^Task "tour": Step 1 sets both/);
  });

  it("ignores tasks without a walkthrough", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.start("say-hello");
    expect(controller.getSnapshot().active).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("replaces the previous Run when another task starts", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.start("create-deck");
    const first = controller.getSnapshot().active!.run;
    onEvent.mockClear();

    controller.start("add-photo");
    expect(first.getSnapshot().phase).toBe("exited");
    expect(controller.getSnapshot().active?.task.id).toBe("add-photo");
    expect(types(onEvent)).toEqual(["taskStopped:create-deck", "taskStarted:add-photo"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "stopped" });
  });

  it("marks a task without a condition done when its Run finishes", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const controller = setup({ onEvent, onChange });
    controller.start("read-tips");
    const { run } = controller.getSnapshot().active!;
    onEvent.mockClear();

    finish(run, 1);

    expect(controller.getSnapshot().active).toBeNull();
    expect(statuses(controller.checklists.home)["read-tips"]).toBe("done");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "read-tips": "done" }));
    expect(types(onEvent)).toEqual(["taskStopped:read-tips", "taskComplete:read-tips"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "finished" });
  });

  it("does not repeat completion when a done task's Run is replayed to the end", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.markDone("read-tips");
    controller.start("read-tips");
    onEvent.mockClear();
    finish(controller.getSnapshot().active!.run, 1);
    expect(types(onEvent)).toEqual(["taskStopped:read-tips"]);
  });

  it("leaves completion to the condition when a guided task finishes", () => {
    const controller = setup();
    controller.start("create-deck");
    finish(controller.getSnapshot().active!.run, 2);
    expect(controller.getSnapshot().active).toBeNull();
    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "todo" });
  });

  it("clears active when the Run exits from its own UI, keeping progress", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.markDone("add-photo");
    controller.start("add-photo");
    onEvent.mockClear();

    controller.getSnapshot().active!.run.act("exit");

    expect(controller.getSnapshot().active).toBeNull();
    expect(statuses(controller.checklists.home)["add-photo"]).toBe("done");
    expect(types(onEvent)).toEqual(["taskStopped:add-photo"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "stopped" });
  });

  it("handles finish before the supplied Run listener sees it, and gives Runs the bound UI", () => {
    const seen: string[] = [];
    const dialog = document.createElement("div");
    const controller = createChecklists({
      context: {},
      tasks: { tips: { walkthrough: single } },
      checklists: { all: ["tips"] },
      onEvent: (event) => seen.push(`controller:${event.type}`),
      run: {
        waymarkPadding: 12,
        onEvent: (event) => {
          seen.push(`run:${event.type}`);
          if (event.type === "finish") seen.push(`active:${controller.getSnapshot().active?.task.id ?? "none"}`);
        },
      },
    });
    expect(controller.waymarkPadding).toBe(12);
    const release = controller.bindUi(() => ({ dialog, beacon: null }));

    controller.start("tips");
    const { run } = controller.getSnapshot().active!;
    const stop = run.subscribe(() => {});
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run.getSnapshot()).toMatchObject({ collapsed: false });
    release();
    addToBody(dialog);
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run.getSnapshot()).toMatchObject({ collapsed: true });
    stop();

    seen.length = 0;
    run.act("advance");
    expect(seen).toEqual([
      "run:advance",
      "controller:taskStopped",
      "controller:taskComplete",
      "controller:checklistComplete",
      "run:finish",
      "active:none",
    ]);
  });

  it("lets the newest UI binding win and releases only its own", () => {
    const controller = setup();
    const a = document.createElement("div");
    const b = document.createElement("div");
    addToBody(a);
    addToBody(b);
    const releaseA = controller.bindUi(() => ({ dialog: a, beacon: null }));
    controller.bindUi(() => ({ dialog: b, beacon: null }));
    controller.start("read-tips");
    const { run } = controller.getSnapshot().active!;
    const stop = run.subscribe(() => {});

    releaseA();
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run.getSnapshot()).toMatchObject({ collapsed: false });
    stop();
  });
});

describe("subscribe", () => {
  it("calls view and controller listeners at once with the current snapshot, then with each new one", () => {
    const controller = setup();
    const view = vi.fn();
    const own = vi.fn<Parameters<typeof controller.subscribe>[0]>();
    controller.checklists.home.subscribe(view);
    controller.subscribe(own);
    expect(view).toHaveBeenCalledExactlyOnceWith(controller.checklists.home.getSnapshot());
    expect(own).toHaveBeenCalledExactlyOnceWith({ active: null, storageStatus: "ready" });

    controller.start("read-tips");
    expect(view).toHaveBeenLastCalledWith(controller.checklists.home.getSnapshot());
    expect(own).toHaveBeenLastCalledWith(controller.getSnapshot());
    expect(own.mock.lastCall![0].active?.task.id).toBe("read-tips");
  });

  it("throws from subscribe if the listener throws when first called, and drops it", () => {
    const controller = setup();
    const broken = vi.fn(() => {
      throw new Error("renderer broke");
    });
    // subscribe calls the listener before returning, so its error surfaces here.
    expect(() => controller.checklists.home.subscribe(broken)).toThrow("renderer broke");

    // The caller got no unsubscribe, so the listener is not kept.
    controller.markDone("say-hello");
    expect(broken).toHaveBeenCalledOnce();
  });
});

describe("subscribeActive", () => {
  const setupRuns = () => {
    const runEvents: string[] = [];
    const controller = createChecklists({
      tasks: { tour: { walkthrough: [{}, {}] }, other: { walkthrough: [{}] } },
      run: { onEvent: (event) => runEvents.push(event.type) },
    });
    return { controller, runEvents };
  };

  it("leaves the active Run asleep when only the controller is subscribed", () => {
    const { controller, runEvents } = setupRuns();
    controller.subscribe(() => {});
    controller.start("tour");
    // Nothing subscribed to the Run, so it never starts watching the page.
    expect(runEvents).toEqual([]);
  });

  it("wakes the active Run, and hears the controller and every step", () => {
    const { controller, runEvents } = setupRuns();
    const listener = vi.fn<Parameters<typeof controller.subscribeActive>[0]>();
    controller.subscribeActive(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ active: null, step: null });

    controller.start("tour");
    expect(runEvents).toEqual(["start"]);
    const { active } = controller.getSnapshot();
    expect(listener).toHaveBeenLastCalledWith({ active, step: active!.run.getSnapshot() });

    active!.run.act("advance");
    expect(listener.mock.lastCall![0].step).toMatchObject({ stepIndex: 1 });

    controller.stop();
    expect(listener).toHaveBeenLastCalledWith({ active: null, step: null });
  });

  it("wakes a Run already active when it subscribes, calling the listener once", () => {
    const { controller, runEvents } = setupRuns();
    controller.start("tour");
    const listener = vi.fn();
    controller.subscribeActive(listener);
    expect(runEvents).toEqual(["start"]);
    // Controller and Run each call at once on subscribe; the listener hears one call.
    const { active } = controller.getSnapshot();
    expect(listener).toHaveBeenCalledExactlyOnceWith({ active, step: active!.run.getSnapshot() });
  });

  it("follows the Run that replaces the last one", () => {
    const { controller, runEvents } = setupRuns();
    controller.subscribeActive(() => {});
    controller.start("tour");
    controller.start("other");
    // The controller exits the old Run once the change is announced, by which
    // time the listener has already moved to the new one.
    expect(runEvents).toEqual(["start", "start", "exit"]);
  });

  it("lets go of the controller and the Run when unsubscribed", () => {
    const { controller } = setupRuns();
    const listener = vi.fn();
    const unsubscribe = controller.subscribeActive(listener);
    controller.start("tour");
    unsubscribe();
    listener.mockClear();

    controller.getSnapshot().active!.run.act("advance");
    controller.stop();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("markDone and skip", () => {
  it("records done everywhere and lets guidance continue", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const controller = setup({ onEvent, onChange });
    controller.start("create-deck");
    onEvent.mockClear();

    controller.checklists.home.markDone("create-deck");

    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "done" });
    expect(controller.getSnapshot().active?.task.id).toBe("create-deck");
    expect(types(onEvent)).toEqual(["taskComplete:create-deck", "checklistComplete:decks"]);
    expect(onChange).toHaveBeenCalledOnce();

    controller.markDone("create-deck");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("skips in every view and exits that task's Run", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const controller = setup({ onEvent, onChange });
    controller.checklists.decks.start("create-deck");
    const { run } = controller.getSnapshot().active!;
    onEvent.mockClear();

    controller.checklists.home.skip("create-deck");

    expect(statuses(controller.checklists.home)["create-deck"]).toBe("skipped");
    expect(statuses(controller.checklists.decks)["create-deck"]).toBe("skipped");
    expect(controller.getSnapshot().active).toBeNull();
    expect(run.getSnapshot().phase).toBe("exited");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "create-deck": "skipped" }));
    expect(types(onEvent)).toEqual([
      "taskStopped:create-deck",
      "taskSkipped:create-deck",
      "checklistComplete:decks",
    ]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "skipped" });
    expect(onEvent.mock.calls[1]![0]).toMatchObject({ checklist: "home" });

    controller.skip("create-deck");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("names the view a skip came from, or the view that started the guidance skipped", () => {
    const onEvent = vi.fn<(event: AnyEvent) => void>();
    const controller = setup({ onEvent });
    const skippedFrom = () =>
      onEvent.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === "taskSkipped")
        .map((event) => `${event.task.id}:${"checklist" in event ? event.checklist : "none"}`);

    controller.checklists.home.skip("say-hello");
    // A guidance renderer's skip, for guidance a view started and guidance the app started.
    controller.checklists.decks.start("create-deck");
    controller.skip("create-deck");
    controller.start("add-photo");
    controller.skip("add-photo");
    // Nothing guided.
    controller.skip("read-tips");

    expect(skippedFrom()).toEqual([
      "say-hello:home",
      "create-deck:decks",
      "add-photo:none",
      "read-tips:none",
    ]);
  });

  it("does not skip a done task", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.markDone("say-hello");
    onEvent.mockClear();
    controller.checklists.home.skip("say-hello");
    expect(statuses(controller.checklists.home)["say-hello"]).toBe("done");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("counts skipped tasks towards completion", () => {
    const controller = setup();
    controller.checklists.home.skip("add-photo");
    controller.checklists.home.skip("create-deck");
    controller.markDone("read-tips");
    controller.markDone("say-hello");
    expect(controller.checklists.home.getSnapshot()).toMatchObject({
      finishedCount: 4,
      taskCount: 4,
      complete: true,
    });
    expect(controller.checklists.decks.getSnapshot().complete).toBe(true);
  });
});

describe("toggle and markTodo", () => {
  it("ticks a todo task and takes a done one back, in every view", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const controller = setup({ onEvent, onChange });

    controller.checklists.home.toggle("say-hello");
    expect(statuses(controller.checklists.home)["say-hello"]).toBe("done");

    controller.checklists.home.toggle("say-hello");
    expect(statuses(controller.checklists.home)["say-hello"]).toBe("todo");
    expect(types(onEvent)).toEqual(["taskComplete:say-hello", "taskReopened:say-hello"]);
    // No condition, so nothing to hold back: the record is empty again.
    expect(onChange).toHaveBeenLastCalledWith(saved({}));
  });

  it("takes a skipped task back, in every view", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.checklists.home.skip("create-deck");
    onEvent.mockClear();

    controller.checklists.decks.toggle("create-deck");

    expect(statuses(controller.checklists.home)["create-deck"]).toBe("todo");
    expect(statuses(controller.checklists.decks)["create-deck"]).toBe("todo");
    expect(types(onEvent)).toEqual(["taskUnskipped:create-deck"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ checklist: "decks" });
  });

  it("keeps a reopened task todo until its condition has been false", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const controller = setup({ context: { ...context, hasPhoto: true }, onEvent, onChange });
    expect(statuses(controller.checklists.home)["add-photo"]).toBe("done");

    controller.checklists.home.toggle("add-photo");
    expect(onChange).toHaveBeenLastCalledWith(saved({ "add-photo": "reopened" }));

    controller.update({ ...context, hasPhoto: true });
    expect(statuses(controller.checklists.home)["add-photo"]).toBe("todo");

    controller.update({ ...context, hasPhoto: false });
    expect(onChange).toHaveBeenLastCalledWith(saved({}));

    onEvent.mockClear();
    controller.update({ ...context, hasPhoto: true });
    expect(statuses(controller.checklists.home)["add-photo"]).toBe("done");
    expect(types(onEvent)).toEqual(["taskComplete:add-photo"]);
  });

  it("forgets the hold when the task is ticked again by hand", () => {
    const onChange = vi.fn();
    const controller = setup({ context: { ...context, hasPhoto: true }, onChange });
    controller.checklists.home.toggle("add-photo");
    controller.checklists.home.toggle("add-photo");
    expect(onChange).toHaveBeenLastCalledWith(saved({ "add-photo": "done" }));
  });

  it("holds a reopened task back across a reload", () => {
    const controller = setup({
      context: { ...context, hasPhoto: true },
      initial: saved({ "add-photo": "reopened" }),
    });
    expect(statuses(controller.checklists.home)["add-photo"]).toBe("todo");
  });

  it("markTodo takes a task back from done or skipped", () => {
    const onEvent = vi.fn();
    const controller = setup({ onEvent });
    controller.markDone("read-tips");
    controller.checklists.home.skip("create-deck");
    onEvent.mockClear();

    controller.markTodo("read-tips");
    controller.markTodo("create-deck");

    expect(statuses(controller.checklists.home)).toMatchObject({ "read-tips": "todo", "create-deck": "todo" });
    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "todo" });
    expect(types(onEvent)).toEqual(["taskReopened:read-tips", "taskUnskipped:create-deck"]);
    expect(onEvent.mock.calls[1]![0]).not.toHaveProperty("checklist");

    onEvent.mockClear();
    controller.markTodo("read-tips");
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("load and clear", () => {
  it("replaces the record without saving or announcing, and notifies changed views", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const controller = setup({ onChange, onEvent });
    controller.markDone("say-hello");
    const home = vi.fn();
    const decks = vi.fn();
    controller.checklists.home.subscribe(home);
    controller.checklists.decks.subscribe(decks);
    home.mockClear();
    decks.mockClear();
    onChange.mockClear();
    onEvent.mockClear();

    controller.load(saved({ ghost: "done", "add-photo": "skipped" }));

    expect(statuses(controller.checklists.home)).toEqual({
      "add-photo": "skipped",
      "create-deck": "todo",
      "read-tips": "todo",
      "say-hello": "todo",
    });
    expect(home).toHaveBeenCalledOnce();
    expect(decks).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();

    controller.markDone("read-tips");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({
      ghost: "done",
      "add-photo": "skipped",
      "read-tips": "done",
    }));
  });

  it("clears everything once, keeps the Run, and is a no-op when already empty", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const controller = setup({ initial: saved({ ghost: "done", gone: "skipped" }), onChange, onEvent });
    controller.markDone("say-hello");
    controller.checklists.decks.skip("create-deck");
    controller.start("add-photo");
    const listener = vi.fn();
    controller.checklists.home.subscribe(listener);
    listener.mockClear();
    onChange.mockClear();
    onEvent.mockClear();

    controller.clear();

    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({}));
    expect(onEvent).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    expect(statuses(controller.checklists.home)).toEqual({
      "add-photo": "todo",
      "create-deck": "todo",
      "read-tips": "todo",
      "say-hello": "todo",
    });
    expect(controller.getSnapshot().active?.task.id).toBe("add-photo");

    controller.clear();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not re-check conditions after clear until the next update", () => {
    const controller = setup({ context: { hasDeck: true, hasPhoto: false } });
    controller.clear();
    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "todo" });
    controller.update({ hasDeck: true, hasPhoto: false });
    expect(statuses(controller.checklists.decks)).toEqual({ "create-deck": "done" });
  });
});

describe("re-entrancy and errors", () => {
  it("runs a command sent from a listener after the current change is fully announced", () => {
    const order: string[] = [];
    const controller = setup({
      onEvent: (event) => order.push(`event:${event.type}`),
    });
    controller.checklists.home.subscribe(() => {
      const status = statuses(controller.checklists.home);
      if (status["read-tips"] === "todo") return;
      order.push(`home:${status["read-tips"]}`);
      if (status["say-hello"] === "todo") controller.markDone("say-hello");
    });

    controller.markDone("read-tips");

    expect(order).toEqual([
      "home:done",
      "event:taskComplete",
      "home:done",
      "event:taskComplete",
    ]);
    expect(statuses(controller.checklists.home)["say-hello"]).toBe("done");
  });

  it("keeps notifying when a listener throws, and reports the errors after", () => {
    const controller = setup();
    const after = vi.fn();
    const done = () => statuses(controller.checklists.home)["say-hello"] === "done";
    controller.checklists.home.subscribe(() => {
      if (done()) throw new Error("first");
    });
    controller.checklists.home.subscribe(() => {
      if (done()) throw new Error("second");
    });
    controller.checklists.home.subscribe(after);
    after.mockClear();

    expect(() => controller.markDone("say-hello")).toThrow(AggregateError);
    expect(after).toHaveBeenCalledOnce();
    expect(statuses(controller.checklists.home)["say-hello"]).toBe("done");
  });

  it.each(["start", "stop", "skip"] as const)(
    "records completion when a Run subscriber calls %s before the finish event",
    (command) => {
      const onEvent = vi.fn<(event: AnyEvent) => void>();
      const onChange = vi.fn();
      const controller = createChecklists({
        context: {},
        tasks: { a: { walkthrough: single }, b: { walkthrough: single } },
        checklists: { all: ["a", "b"], first: ["a"] },
        onEvent,
        onChange,
      });
      controller.start("a");
      const run = controller.getSnapshot().active!.run;
      const unsubscribe = run.subscribe(() => {
        if (run.getSnapshot().phase !== "completed") return;
        if (command === "start") controller.start("b");
        else if (command === "stop") controller.stop();
        else controller.checklists.all.skip("a");
      });
      onEvent.mockClear();

      try {
        run.act("advance");
        expect(statuses(controller.checklists.all)["a"]).toBe("done");
        expect(statuses(controller.checklists.first)["a"]).toBe("done");
        expect(controller.getSnapshot().active?.task.id ?? null).toBe(command === "start" ? "b" : null);
        expect(run.getSnapshot().phase).toBe("completed");
        expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ a: "done" }));
        expect(types(onEvent)).toEqual([
          "taskStopped:a",
          "taskComplete:a",
          ...(command === "start" ? ["taskStarted:b"] : []),
          "checklistComplete:first",
        ]);
        expect(onEvent.mock.calls.find(([event]) => event.type === "taskStopped")![0]).toMatchObject({
          reason: "finished",
        });
      } finally {
        unsubscribe();
      }
    },
  );

  it("still requires the completion condition when a Run subscriber starts another task", () => {
    const onEvent = vi.fn();
    const controller = createChecklists({
      context: { ready: false },
      tasks: {
        a: { walkthrough: single, isComplete: (c) => c.ready },
        b: { walkthrough: single },
      },
      checklists: { all: ["a", "b"] },
      onEvent,
    });
    controller.start("a");
    const run = controller.getSnapshot().active!.run;
    const unsubscribe = run.subscribe(() => {
      if (run.getSnapshot().phase === "completed") controller.start("b");
    });
    onEvent.mockClear();

    try {
      run.act("advance");
      expect(statuses(controller.checklists.all)["a"]).toBe("todo");
      expect(controller.getSnapshot().active?.task.id).toBe("b");
      expect(types(onEvent)).toEqual(["taskStopped:a", "taskStarted:b"]);
      expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "finished" });

      controller.update({ ready: true });
      expect(statuses(controller.checklists.all)["a"]).toBe("done");
      expect(controller.getSnapshot().active?.task.id).toBe("b");
    } finally {
      unsubscribe();
    }
  });

  it("keeps a skip made from a finished Run when the task has a completion condition", () => {
    const onEvent = vi.fn();
    const controller = createChecklists({
      context: { ready: false },
      tasks: { a: { walkthrough: single, isComplete: (c) => c.ready } },
      checklists: { all: ["a"] },
      onEvent,
    });
    controller.start("a");
    const run = controller.getSnapshot().active!.run;
    const unsubscribe = run.subscribe(() => {
      if (run.getSnapshot().phase === "completed") controller.checklists.all.skip("a");
    });
    onEvent.mockClear();

    try {
      run.act("advance");
      expect(statuses(controller.checklists.all)["a"]).toBe("skipped");
      expect(types(onEvent)).toEqual(["taskStopped:a", "taskSkipped:a", "checklistComplete:all"]);
      expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "finished" });
    } finally {
      unsubscribe();
    }
  });

  it("starts another task from a Run listener without confusing the controller", () => {
    const events: string[] = [];
    const controller = createChecklists({
      context: {},
      tasks: { a: { walkthrough: single }, b: { walkthrough: single } },
      checklists: { all: ["a", "b"] },
      onEvent: (event) => events.push(`${event.type}:${"task" in event ? event.task.id : event.checklist}`),
      run: {
        onEvent: (event) => {
          if (event.type === "finish" && controller.getSnapshot().active === null) controller.start("b");
        },
      },
    });
    controller.start("a");
    finish(controller.getSnapshot().active!.run, 1);
    expect(controller.getSnapshot().active?.task.id).toBe("b");
    expect(events).toEqual([
      "taskStarted:a",
      "taskStopped:a",
      "taskComplete:a",
      "taskStarted:b",
    ]);
  });
});

describe("a task written in its own file", () => {
  it("is used unchanged by a controller", () => {
    const task = { walkthrough: guide, isComplete: (c) => c.hasDeck } satisfies Task<Context>;
    const controller = createChecklists({
      context,
      tasks: { deck: task },
      checklists: { all: ["deck"] },
    });
    expect(controller.checklists.all.getSnapshot().tasks[0]!.task.walkthrough).toBe(guide);
  });
});
