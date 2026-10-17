import { describe, expect, it, vi } from "vitest";
import { addTarget } from "../test/dom";
import { skipFirstCall } from "../test/listeners";
import { progressOf, watch } from "../test/run";
import { fakeFrames } from "../test/time";
import { defineChecklists } from "./checklists";
import { everyProblem } from "../problems";
import { createRun } from "../run/run";
import type { RunOptions, WaymarkEvent } from "../run/types";
import type { StoredRecord } from "../storage/records";
import type { ChecklistsEvent, Task } from "./types";
import { defineWalkthrough } from "../walkthrough/walkthrough";

const guide = defineWalkthrough({ id: "guide", steps: [{ waymark: "save" }, {}] });
const photo = defineWalkthrough({ id: "photo", steps: [{}] });
const tips = defineWalkthrough({ id: "tips", steps: [{}] });

type Context = { hasDeck: boolean; hasPhoto: boolean };
const context: Context = { hasDeck: false, hasPhoto: false };

const onboarding = defineChecklists({
  tasks: {
    "create-deck": { walkthrough: guide, isComplete: (c: Context) => c.hasDeck },
    "add-photo": { walkthrough: photo, isComplete: (c: Context) => c.hasPhoto },
    "read-tips": { walkthrough: tips },
    "say-hello": {},
  },
  checklists: {
    home: ["add-photo", "create-deck", "read-tips", "say-hello"],
    decks: ["create-deck"],
  },
});

/** Task statuses as the record holds them. */
const saved = (tasks: StoredRecord["tasks"], walkthroughs: StoredRecord["walkthroughs"] = {}): StoredRecord => ({
  version: 4,
  walkthroughs,
  tasks,
});

/** A Run with onboarding's checklists in use, as a drawn checklist would have them. */
const setup = (options: RunOptions = {}) => {
  const run = createRun({ context, ...options });
  const home = run.checklist(onboarding.checklists.home);
  const decks = run.checklist(onboarding.checklists.decks);
  home.subscribe(() => {});
  return { run, home, decks };
};

const statuses = (view: { getSnapshot: () => { tasks: readonly { task: { id: string }; status: string }[] } }) =>
  Object.fromEntries(view.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

/** Each checklist event as `type:task` or `type:checklist`. */
const taskEvents = (onEvent: { mock: { calls: unknown[][] } }) =>
  onEvent.mock.calls.flatMap(([event]) => {
    const e = event as WaymarkEvent;
    if ("walkthrough" in e) return [];
    return ["task" in e ? `${e.type}:${e.task.id}` : `${e.type}:${e.checklist}`];
  });

/** Every event, a walkthrough's as `id:type`. */
const allEvents = (onEvent: { mock: { calls: unknown[][] } }) =>
  onEvent.mock.calls.map(([event]) => {
    const e = event as WaymarkEvent;
    if ("walkthrough" in e) return `${e.walkthrough}:${e.type}`;
    return "task" in e ? `${e.type}:${e.task.id}` : `${e.type}:${e.checklist}`;
  });

const eventOf = (onEvent: { mock: { calls: unknown[][] } }, type: ChecklistsEvent["type"]) =>
  onEvent.mock.calls.map(([event]) => event as ChecklistsEvent).find((event) => event.type === type);

describe("defineChecklists", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "supports %s as both a task id and checklist name",
    (name) => {
      const onChange = vi.fn<(stored: StoredRecord) => void>();
      const defined = defineChecklists({ tasks: { [name]: { walkthrough: [{}] } }, checklists: { [name]: [name] } });
      const definition = defined.checklists[name]!;
      expect(Object.hasOwn(defined.checklists, name)).toBe(true);
      const run = createRun({ onChange });
      const view = run.checklist(definition);
      expect(view.getSnapshot().tasks[0]).toMatchObject({ task: { id: name }, status: "todo" });

      view.start(name);
      expect(run.getSnapshot().open?.walkthrough.id).toBe(name);
      view.skip(name);
      expect(view.getSnapshot().tasks[0]!.status).toBe("skipped");
      const stored = onChange.mock.lastCall![0];
      expect(Object.hasOwn(stored.tasks, name)).toBe(true);
      expect(stored.tasks[name]).toBe("skipped");

      const reloaded = createRun({ initial: JSON.parse(JSON.stringify(stored)) as StoredRecord, onChange });
      const again = reloaded.checklist(definition);
      expect(again.getSnapshot().tasks[0]!.status).toBe("skipped");
      again.markDone(name);
      expect(again.getSnapshot().tasks[0]!.status).toBe("done");
      expect(onChange.mock.lastCall![0].tasks).toEqual({ [name]: "done" });
    },
  );

  it("works without a context", () => {
    const run = createRun();
    const home = run.checklist(defineChecklists({ tasks: { hello: {} }, checklists: { home: ["hello"] } }).checklists.home);
    home.markDone("hello");
    expect(home.getSnapshot().complete).toBe(true);
  });

  it("checks no condition while the Run has no context", () => {
    const upgrade = defineChecklists({
      tasks: { upgrade: { isComplete: (c: { user: { plan: string } }) => c.user.plan === "pro" } },
    });
    const run = createRun();
    const main = run.checklist(upgrade.checklists.main);
    main.subscribe(() => {});
    expect(statuses(main)).toEqual({ upgrade: "todo" });

    run.setContext({ user: { plan: "pro" } });
    expect(statuses(main)).toEqual({ upgrade: "done" });
  });

  it("has one checklist, main, of every task in order when it names none", () => {
    const onChange = vi.fn();
    const defined = defineChecklists({ tasks: { tour: { walkthrough: [{}] }, hello: {}, invite: {} } });
    expect(Object.keys(defined.checklists)).toEqual(["main"]);
    const main = createRun({ onChange }).checklist(defined.checklists.main);
    expect(main.getSnapshot().tasks.map((row) => row.task.id)).toEqual(["tour", "hello", "invite"]);

    main.skip("hello");
    expect(onChange).toHaveBeenLastCalledWith(saved({ hello: "skipped" }));
  });

  it("rejects definitions it cannot show", () => {
    expect(() => defineChecklists({ tasks: {}, checklists: { a: [] } })).toThrow(/at least one task/);
    expect(() =>
      defineChecklists({ tasks: { a: {} }, checklists: {} as { a: readonly ["a"] } }),
    ).toThrow(/at least one checklist/);
    expect(() =>
      defineChecklists({ tasks: { a: {} }, checklists: { home: [] as unknown as ["a"] } }),
    ).toThrow(/selects no tasks/);
    expect(() => defineChecklists({ tasks: { a: {} }, checklists: { home: ["a", "a"] } })).toThrow(/repeats task "a"/);
    expect(() => defineChecklists({ tasks: { a: {} }, checklists: { home: ["b" as "a"] } })).toThrow(/unknown task "b"/);
    expect(() => defineChecklists({ tasks: { "": {} }, checklists: { home: [""] } })).toThrow(/cannot be empty/);
  });

  it("checks inline steps as it defines them, naming the task", () => {
    expect(() => defineChecklists({ tasks: { tour: { walkthrough: [] } } })).toThrow(
      'Task "tour": A walkthrough needs at least one step.',
    );
    expect(() =>
      defineChecklists({ tasks: { tour: { walkthrough: [{}, { waymark: "a", selector: "#a" }] } } }),
    ).toThrow(/^Task "tour": Step 1 sets both/);
  });

  it("shows every task of a selection in its order, with its id and definition", () => {
    const { home, decks } = setup();
    const rows = home.getSnapshot().tasks;
    expect(rows.map((row) => row.task.id)).toEqual(["add-photo", "create-deck", "read-tips", "say-hello"]);
    const deck = rows[1]!.task;
    if (deck.id !== "create-deck") throw new Error("expected create-deck");
    expect(deck.walkthrough).toBe(guide);
    expect(rows[1]).toMatchObject({ status: "todo", inProgress: false });
    expect(decks.getSnapshot()).toMatchObject({ finishedCount: 0, taskCount: 1, complete: false, open: null });
  });

  it("records matching conditions once a checklist is used, saving but announcing nothing", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const { decks } = setup({ context: { hasDeck: true, hasPhoto: false }, onChange, onEvent });
    expect(statuses(decks)).toEqual({ "create-deck": "done" });
    expect(decks.getSnapshot().complete).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "create-deck": "done" }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not save the record it starts from", () => {
    const onChange = vi.fn();
    const { run, home } = setup({ initial: saved({ "read-tips": "done", "say-hello": "skipped" }), onChange });
    expect(onChange).not.toHaveBeenCalled();
    expect(statuses(home)).toMatchObject({ "read-tips": "done", "say-hello": "skipped" });

    home.markDone("say-hello");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "read-tips": "done", "say-hello": "done" }));
    expect(run.getSnapshot().storageStatus).toBe("ready");
  });

  it("preserves unknown ids across local changes", () => {
    const onChange = vi.fn();
    const { decks } = setup({ initial: saved({ zeta: "done", gone: "skipped", old: "reopened" }), onChange });
    decks.skip("create-deck");
    expect(onChange).toHaveBeenLastCalledWith(saved({
      zeta: "done",
      gone: "skipped",
      old: "reopened",
      "create-deck": "skipped",
    }));
  });
});

describe("context", () => {
  it("records done in every view, once, and announces task then checklist completion", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const { run, home, decks } = setup({ onChange, onEvent });
    const homeListener = vi.fn();
    const decksListener = vi.fn();
    home.subscribe(homeListener);
    decks.subscribe(decksListener);
    homeListener.mockClear();
    decksListener.mockClear();

    run.setContext({ hasDeck: true, hasPhoto: false });

    expect(statuses(home)["create-deck"]).toBe("done");
    expect(statuses(decks)["create-deck"]).toBe("done");
    expect(homeListener).toHaveBeenCalledOnce();
    expect(decksListener).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({ "create-deck": "done" }));
    expect(taskEvents(onEvent)).toEqual(["taskComplete:create-deck", "checklistComplete:decks"]);
    const complete = eventOf(onEvent, "checklistComplete") as Extract<ChecklistsEvent, { type: "checklistComplete" }>;
    expect(complete.snapshot).toBe(decks.getSnapshot());
    expect(complete.snapshot.finishedCount).toBe(1);
  });

  it("checks in task order and commits everything together", () => {
    const seen: string[] = [];
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const ready = defineChecklists({
      tasks: {
        b: { isComplete: (c: { ready: boolean }) => (seen.push("b"), c.ready) },
        a: { isComplete: (c: { ready: boolean }) => (seen.push("a"), c.ready) },
      },
      checklists: { all: ["a", "b"] },
    });
    const run = createRun({
      context: { ready: false },
      initial: saved({ "unknown-task": "done", a: "skipped", "unknown-skipped": "skipped" }),
      onEvent,
      onChange,
    });
    const all = run.checklist(ready.checklists.all);
    const listener = vi.fn();
    all.subscribe(listener);
    listener.mockClear();
    seen.length = 0;

    run.setContext({ ready: true });
    expect(seen).toEqual(["b", "a"]);
    expect(listener).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved({
      "unknown-task": "done",
      a: "done",
      b: "done",
      "unknown-skipped": "skipped",
    }));
    expect(taskEvents(onEvent)).toEqual(["taskComplete:b", "taskComplete:a", "checklistComplete:all"]);
  });

  it("leaves done tasks alone and does not re-check them", () => {
    const isComplete = vi.fn((c: { ready: boolean }) => c.ready);
    const run = createRun({ context: { ready: true } });
    const all = run.checklist(defineChecklists({ tasks: { a: { isComplete } }, checklists: { all: ["a"] } }).checklists.all);
    all.subscribe(() => {});
    isComplete.mockClear();
    run.setContext({ ready: false });
    expect(isComplete).not.toHaveBeenCalled();
    expect(statuses(all)).toEqual({ a: "done" });
  });

  it("checks nothing again for the same context", () => {
    const isComplete = vi.fn(() => false);
    const run = createRun({ context });
    run.checklist(defineChecklists({ tasks: { a: { isComplete } } }).checklists.main).subscribe(() => {});
    isComplete.mockClear();
    run.setContext(context);
    expect(isComplete).not.toHaveBeenCalled();
  });

  it("lets done override skipped everywhere without repeating a view's completion", () => {
    const onEvent = vi.fn();
    const { run, decks } = setup({ onEvent });
    decks.skip("create-deck");
    expect(taskEvents(onEvent)).toEqual(["taskSkipped:create-deck", "checklistComplete:decks"]);
    onEvent.mockClear();

    run.setContext({ hasDeck: true, hasPhoto: false });
    expect(statuses(decks)).toEqual({ "create-deck": "done" });
    expect(taskEvents(onEvent)).toEqual(["taskComplete:create-deck"]);
  });

  const throwing = defineChecklists({
    tasks: {
      a: { isComplete: (c: { ready: boolean }) => c.ready },
      b: {
        isComplete: (c: { ready: boolean }) => {
          if (c.ready) throw new Error("boom");
          return false;
        },
      },
    },
    checklists: { all: ["a", "b"] },
  });

  it("records nothing when a condition throws", () => {
    const run = createRun({ context: { ready: false } });
    const all = run.checklist(throwing.checklists.all);
    all.subscribe(() => {});
    expect(() => run.setContext({ ready: true })).toThrow("boom");
    expect(statuses(all)).toEqual({ a: "todo", b: "todo" });
  });

  it("sends a throwing isComplete to problemHandlers instead of throwing, and leaves every task todo", () => {
    const onProblem = vi.fn();
    const run = createRun({ context: { ready: false }, problemHandlers: everyProblem(onProblem) });
    const all = run.checklist(throwing.checklists.all);
    all.subscribe(() => {});
    expect(() => run.setContext({ ready: true })).not.toThrow();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "callbackThrew",
      callback: "isComplete",
      error: new Error("boom"),
    });
    expect(statuses(all)).toEqual({ a: "todo", b: "todo" });
  });

  it("sends errors from subscribers, onChange and onEvent to problemHandlers, and still applies each change", () => {
    const onProblem = vi.fn();
    const broken = new Error("broken");
    const fail = () => {
      throw broken;
    };
    const run = createRun({ onChange: fail, onEvent: fail, problemHandlers: everyProblem(onProblem) });
    const main = run.checklist(defineChecklists({ tasks: { a: { walkthrough: [{}] }, b: {} } }).checklists.main);
    main.subscribe(skipFirstCall(fail));

    expect(() => main.markDone("b")).not.toThrow();
    expect(() => main.start("a")).not.toThrow();
    expect(() => run.act("advance")).not.toThrow();
    expect(statuses(main)).toEqual({ a: "done", b: "done" });
    const threw = (callback: string) => [{ type: "callbackThrew", callback, error: broken }];
    expect(onProblem.mock.calls).toEqual(
      [
        // markDone("b"); onEvent hears taskComplete
        "subscriber", "onChange", "onEvent",
        // start("a"); onEvent hears taskStarted
        "subscriber", "onChange", "onEvent",
        // advance; onEvent hears advance and finish, then taskStopped, taskComplete and checklistComplete
        "subscriber", "onChange", "onEvent", "onEvent", "onEvent", "onEvent", "onEvent",
      ].map(threw),
    );
  });

  it("sends an error from a subscriber's first call to problemHandlers", () => {
    const onProblem = vi.fn();
    const fail = () => {
      throw new Error("broken");
    };
    const run = createRun({ problemHandlers: everyProblem(onProblem) });
    expect(() => run.subscribe(fail)).not.toThrow();
    expect(() => run.checklist(onboarding.checklists.home).subscribe(fail)).not.toThrow();
    expect(onProblem).toHaveBeenCalledTimes(2);
  });

  it("sends a missing waymark in a task's walkthrough to the Run's problemHandlers", () => {
    const { flush } = fakeFrames();
    const onProblem = vi.fn();
    const { run, decks } = setup({ problemHandlers: everyProblem(onProblem) });
    watch(run);
    decks.start("create-deck");
    flush(3000);
    flush();
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "waymarkMissing",
      walkthrough: "guide",
      step: { waymark: "save" },
      stepIndex: 0,
    });
  });

  it("keeps an unaffected view's snapshot identity", () => {
    const { run, home, decks } = setup();
    const decksBefore = decks.getSnapshot();
    const homeBefore = home.getSnapshot();
    run.setContext({ hasDeck: false, hasPhoto: true });
    expect(decks.getSnapshot()).toBe(decksBefore);
    expect(home.getSnapshot()).not.toBe(homeBefore);
  });
});

describe("guidance", () => {
  it("opens a task's walkthrough, shows the task open in every view holding it, and stops it on exit", () => {
    const onEvent = vi.fn();
    const { run, home, decks } = setup({ onEvent });

    decks.start("create-deck");

    expect(run.getSnapshot().open).toMatchObject({ walkthrough: guide, task: "create-deck", snapshot: { stepIndex: 0 } });
    expect(home.getSnapshot().open?.id).toBe("create-deck");
    expect(decks.getSnapshot().open).toBe(home.getSnapshot().open);
    expect(taskEvents(onEvent)).toEqual(["taskStarted:create-deck"]);

    const before = home.getSnapshot();
    home.start("create-deck");
    expect(home.getSnapshot()).toBe(before);

    run.act("exit");
    expect(home.getSnapshot().open).toBeNull();
    expect(statuses(home)["create-deck"]).toBe("todo");
    expect(taskEvents(onEvent)).toEqual(["taskStarted:create-deck", "taskStopped:create-deck"]);
    expect(eventOf(onEvent, "taskStopped")).toMatchObject({ reason: "stopped" });
  });

  it("hides the open task from views that do not hold it", () => {
    const { home, decks } = setup();
    home.start("add-photo");
    expect(home.getSnapshot().open?.id).toBe("add-photo");
    expect(decks.getSnapshot().open).toBeNull();
  });

  it("runs steps written inline on the task under the task's id, and shows the task as written", () => {
    const steps = [{ waymark: "save" }, {}] as const;
    const run = createRun();
    const home = run.checklist(defineChecklists({ tasks: { tour: { walkthrough: steps } }, checklists: { home: ["tour"] } }).checklists.home);
    expect(home.getSnapshot().tasks[0]!.task.walkthrough).toBe(steps);

    home.start("tour");
    expect(run.getSnapshot().open).toMatchObject({ walkthrough: { id: "tour", steps }, snapshot: { stepCount: 2 } });
    run.act("advance");
    run.act("advance");
    expect(statuses(home)).toEqual({ tour: "done" });
  });

  it("ignores tasks without a walkthrough", () => {
    const onEvent = vi.fn();
    const { run, home } = setup({ onEvent });
    home.start("say-hello");
    expect(run.getSnapshot().open).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("collapses the open task's walkthrough when another task starts, and shows it in progress", () => {
    const onEvent = vi.fn();
    const { run, home } = setup({ onEvent });
    home.start("create-deck");
    onEvent.mockClear();

    home.start("add-photo");
    expect(home.getSnapshot().open?.id).toBe("add-photo");
    expect(home.getSnapshot().tasks.find((row) => row.task.id === "create-deck")).toMatchObject({
      status: "todo",
      inProgress: true,
    });
    expect(allEvents(onEvent)).toEqual(["guide:interrupt", "taskStarted:add-photo"]);

    run.act("exit");
    home.start("create-deck");
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
    expect(allEvents(onEvent).at(-1)).toBe("guide:resume");
  });

  it("stops a task whose walkthrough exits when dismissed, leaving it todo, and starts it again from its first step", () => {
    const onEvent = vi.fn();
    const hint = defineWalkthrough({ id: "hint", steps: [{}, {}], dismiss: "exit" });
    const run = createRun({ onEvent });
    const main = run.checklist(defineChecklists({ tasks: { hint: { walkthrough: hint }, other: { walkthrough: [{}] } } }).checklists.main);
    main.start("hint");
    run.act("advance");

    main.start("other");
    expect(statuses(main)).toEqual({ hint: "todo", other: "todo" });
    expect(taskEvents(onEvent)).toEqual(["taskStarted:hint", "taskStopped:hint", "taskStarted:other"]);
    expect(eventOf(onEvent, "taskStopped")).toMatchObject({ reason: "stopped" });

    main.start("hint");
    expect(run.getSnapshot().open?.snapshot).toMatchObject({ stepIndex: 0 });
  });

  it("marks a task without a condition done when its walkthrough finishes, after the walkthrough's own events", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const { run, home } = setup({ onEvent, onChange });
    home.start("read-tips");
    onEvent.mockClear();
    onChange.mockClear();

    run.act("advance");

    expect(run.getSnapshot().open).toBeNull();
    expect(statuses(home)["read-tips"]).toBe("done");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      saved({ "read-tips": "done" }, { tips: expect.objectContaining({ status: "finished" }) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    );
    expect(allEvents(onEvent)).toEqual(["tips:advance", "tips:finish", "taskStopped:read-tips", "taskComplete:read-tips"]);
    expect(eventOf(onEvent, "taskStopped")).toMatchObject({ reason: "finished" });
  });

  it("does not repeat completion when a done task's walkthrough is replayed to the end", () => {
    const onEvent = vi.fn();
    const { run, home } = setup({ onEvent });
    home.markDone("read-tips");
    home.start("read-tips");
    onEvent.mockClear();
    run.act("advance");
    expect(taskEvents(onEvent)).toEqual(["taskStopped:read-tips"]);
  });

  it("leaves completion to the condition when a guided task finishes", () => {
    const { run, decks } = setup();
    decks.start("create-deck");
    run.act("advance");
    run.act("advance");
    expect(run.getSnapshot().open).toBeNull();
    expect(statuses(decks)).toEqual({ "create-deck": "todo" });
  });

  it("keeps a task's status when its walkthrough exits from its own UI", () => {
    const onEvent = vi.fn();
    const { run, home } = setup({ onEvent });
    home.markDone("add-photo");
    home.start("add-photo");
    onEvent.mockClear();

    run.act("exit");

    expect(statuses(home)["add-photo"]).toBe("done");
    expect(taskEvents(onEvent)).toEqual(["taskStopped:add-photo"]);
  });

  it("counts a task's walkthrough started from anywhere as the task starting", () => {
    const onEvent = vi.fn();
    const { run } = setup({ onEvent });
    run.start(tips);
    expect(taskEvents(onEvent)).toEqual(["taskStarted:read-tips"]);
    expect(run.getSnapshot().open?.task).toBe("read-tips");
  });
});

describe("subscribe", () => {
  it("calls view and Run listeners at once with the current snapshot, then with each new one", () => {
    const { run, home } = setup();
    const view = vi.fn();
    const own = vi.fn();
    home.subscribe(view);
    run.subscribe(own);
    expect(view).toHaveBeenCalledExactlyOnceWith(home.getSnapshot());
    expect(own).toHaveBeenCalledExactlyOnceWith(run.getSnapshot());

    home.start("read-tips");
    expect(view).toHaveBeenLastCalledWith(home.getSnapshot());
    expect(own).toHaveBeenLastCalledWith(run.getSnapshot());
  });

  it("hands back the same view for one definition", () => {
    const run = createRun();
    expect(run.checklist(onboarding.checklists.home)).toBe(run.checklist(onboarding.checklists.home));
  });

  it("throws from subscribe if the listener throws when first called, and drops it", () => {
    const { home } = setup();
    const broken = vi.fn(() => {
      throw new Error("renderer broke");
    });
    // subscribe calls the listener before returning, so its error surfaces here.
    expect(() => home.subscribe(broken)).toThrow("renderer broke");

    // The caller got no unsubscribe, so the listener is not kept.
    home.markDone("say-hello");
    expect(broken).toHaveBeenCalledOnce();
  });
});

describe("markDone and skip", () => {
  it("records done everywhere and lets guidance continue", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const { run, home, decks } = setup({ onEvent, onChange });
    home.start("create-deck");
    onEvent.mockClear();
    onChange.mockClear();

    home.markDone("create-deck");

    expect(statuses(decks)).toEqual({ "create-deck": "done" });
    expect(run.getSnapshot().open?.task).toBe("create-deck");
    expect(taskEvents(onEvent)).toEqual(["taskComplete:create-deck", "checklistComplete:decks"]);
    expect(onChange).toHaveBeenCalledOnce();

    decks.markDone("create-deck");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("skips in every view and exits that task's walkthrough", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const { run, home, decks } = setup({ onEvent, onChange });
    decks.start("create-deck");
    onEvent.mockClear();
    onChange.mockClear();

    home.skip("create-deck");

    expect(statuses(home)["create-deck"]).toBe("skipped");
    expect(statuses(decks)["create-deck"]).toBe("skipped");
    expect(run.getSnapshot().open).toBeNull();
    expect(progressOf(run, "guide")?.status).toBe("exited");
    expect(onChange).toHaveBeenCalledOnce();
    expect(allEvents(onEvent)).toEqual([
      "guide:exit",
      "taskStopped:create-deck",
      "taskSkipped:create-deck",
      "checklistComplete:decks",
    ]);
    expect(eventOf(onEvent, "taskStopped")).toMatchObject({ reason: "skipped" });
    expect(eventOf(onEvent, "taskSkipped")).toMatchObject({ checklist: "home" });

    decks.skip("create-deck");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("skips a task in progress, exiting its collapsed walkthrough", () => {
    const { run, home } = setup();
    home.start("create-deck");
    run.act("collapse");

    home.skip("create-deck");
    expect(progressOf(run, "guide")?.status).toBe("exited");
    expect(run.getSnapshot().beacons).toEqual([]);
  });

  it("names the checklist a skip came from, or the one whose Start began the walkthrough skipped from its popover", () => {
    const onEvent = vi.fn();
    const { run, home, decks } = setup({ onEvent });
    const skippedFrom = () =>
      onEvent.mock.calls
        .map(([event]) => event as ChecklistsEvent)
        .filter((event) => event.type === "taskSkipped")
        .map((event) => `${event.task.id}:${"checklist" in event ? event.checklist : "none"}`);

    home.skip("say-hello");
    // The popover's skip, for a walkthrough a checklist started and one the app started.
    decks.start("create-deck");
    run.skipTask("create-deck");
    run.start(photo);
    run.skipTask("add-photo");
    // Nothing open.
    run.skipTask("read-tips");

    expect(skippedFrom()).toEqual([
      "say-hello:home",
      "create-deck:decks",
      "add-photo:none",
      "read-tips:none",
    ]);
  });

  it("does not skip a done task", () => {
    const onEvent = vi.fn();
    const { home } = setup({ onEvent });
    home.markDone("say-hello");
    onEvent.mockClear();
    home.skip("say-hello");
    expect(statuses(home)["say-hello"]).toBe("done");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("counts skipped tasks towards completion", () => {
    const { home, decks } = setup();
    home.skip("add-photo");
    home.skip("create-deck");
    home.markDone("read-tips");
    home.markDone("say-hello");
    expect(home.getSnapshot()).toMatchObject({ finishedCount: 4, taskCount: 4, complete: true });
    expect(decks.getSnapshot().complete).toBe(true);
  });
});

describe("toggle and markTodo", () => {
  it("ticks a todo task and takes a done one back, in every view", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const { home } = setup({ onEvent, onChange });

    home.toggle("say-hello");
    expect(statuses(home)["say-hello"]).toBe("done");

    home.toggle("say-hello");
    expect(statuses(home)["say-hello"]).toBe("todo");
    expect(taskEvents(onEvent)).toEqual(["taskComplete:say-hello", "taskReopened:say-hello"]);
    // No condition, so nothing to hold back: the record is empty again.
    expect(onChange).toHaveBeenLastCalledWith(saved({}));
  });

  it("takes a skipped task back, in every view", () => {
    const onEvent = vi.fn();
    const { home, decks } = setup({ onEvent });
    home.skip("create-deck");
    onEvent.mockClear();

    decks.toggle("create-deck");

    expect(statuses(home)["create-deck"]).toBe("todo");
    expect(statuses(decks)["create-deck"]).toBe("todo");
    expect(taskEvents(onEvent)).toEqual(["taskUnskipped:create-deck"]);
    expect(eventOf(onEvent, "taskUnskipped")).toMatchObject({ checklist: "decks" });
  });

  it("keeps a reopened task todo until its condition has been false", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const { run, home } = setup({ context: { ...context, hasPhoto: true }, onEvent, onChange });
    expect(statuses(home)["add-photo"]).toBe("done");

    home.toggle("add-photo");
    expect(onChange).toHaveBeenLastCalledWith(saved({ "add-photo": "reopened" }));

    run.setContext({ ...context, hasPhoto: true });
    expect(statuses(home)["add-photo"]).toBe("todo");

    run.setContext({ ...context, hasPhoto: false });
    expect(onChange).toHaveBeenLastCalledWith(saved({}));

    onEvent.mockClear();
    run.setContext({ ...context, hasPhoto: true });
    expect(statuses(home)["add-photo"]).toBe("done");
    expect(taskEvents(onEvent)).toEqual(["taskComplete:add-photo"]);
  });

  it("forgets the hold when the task is ticked again by hand", () => {
    const onChange = vi.fn();
    const { home } = setup({ context: { ...context, hasPhoto: true }, onChange });
    home.toggle("add-photo");
    home.toggle("add-photo");
    expect(onChange).toHaveBeenLastCalledWith(saved({ "add-photo": "done" }));
  });

  it("holds a reopened task back across a reload", () => {
    const { home } = setup({ context: { ...context, hasPhoto: true }, initial: saved({ "add-photo": "reopened" }) });
    expect(statuses(home)["add-photo"]).toBe("todo");
  });

  it("markTodo takes a task back from done or skipped", () => {
    const onEvent = vi.fn();
    const { home, decks } = setup({ onEvent });
    home.markDone("read-tips");
    home.skip("create-deck");
    onEvent.mockClear();

    home.markTodo("read-tips");
    home.markTodo("create-deck");

    expect(statuses(home)).toMatchObject({ "read-tips": "todo", "create-deck": "todo" });
    expect(statuses(decks)).toEqual({ "create-deck": "todo" });
    expect(taskEvents(onEvent)).toEqual(["taskReopened:read-tips", "taskUnskipped:create-deck"]);
    expect(eventOf(onEvent, "taskUnskipped")).toMatchObject({ checklist: "home" });

    onEvent.mockClear();
    home.markTodo("read-tips");
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("re-entrancy and errors", () => {
  it("runs a command sent from a listener after the current change is fully announced", () => {
    const order: string[] = [];
    const { home } = setup({
      onEvent: (event) => order.push(`event:${event.type}`),
    });
    home.subscribe(() => {
      const status = statuses(home);
      if (status["read-tips"] === "todo") return;
      order.push(`home:${status["read-tips"]}`);
      if (status["say-hello"] === "todo") home.markDone("say-hello");
    });

    home.markDone("read-tips");

    expect(order).toEqual([
      "home:done",
      "event:taskComplete",
      "home:done",
      "event:taskComplete",
    ]);
    expect(statuses(home)["say-hello"]).toBe("done");
  });

  it("keeps notifying when a listener throws, and reports the errors after", () => {
    const { home } = setup();
    const after = vi.fn();
    const done = () => statuses(home)["say-hello"] === "done";
    home.subscribe(() => {
      if (done()) throw new Error("first");
    });
    home.subscribe(() => {
      if (done()) throw new Error("second");
    });
    home.subscribe(after);
    after.mockClear();

    expect(() => home.markDone("say-hello")).toThrow(AggregateError);
    expect(after).toHaveBeenCalledOnce();
    expect(statuses(home)["say-hello"]).toBe("done");
  });

  const pair = defineChecklists({
    tasks: { a: { walkthrough: [{}] }, b: { walkthrough: [{}] } },
    checklists: { all: ["a", "b"], first: ["a"] },
  });

  it.each(["start", "exit", "skip"] as const)(
    "has recorded completion by the time a subscriber that saw the walkthrough finish calls %s",
    (command) => {
      const onEvent = vi.fn();
      const onChange = vi.fn();
      const run = createRun({ onEvent, onChange });
      const all = run.checklist(pair.checklists.all);
      const first = run.checklist(pair.checklists.first);
      all.start("a");
      run.subscribe(() => {
        if (progressOf(run, "a")?.status !== "finished") return;
        expect(statuses(all)["a"]).toBe("done");
        if (command === "start") all.start("b");
        else if (command === "exit") run.act("exit");
        else all.skip("a");
      });
      onEvent.mockClear();
      onChange.mockClear();

      run.act("advance");
      expect(statuses(all)["a"]).toBe("done");
      expect(statuses(first)["a"]).toBe("done");
      expect(run.getSnapshot().open?.task ?? null).toBe(command === "start" ? "b" : null);
      expect(taskEvents(onEvent)).toEqual([
        "taskStopped:a",
        "taskComplete:a",
        "checklistComplete:first",
        ...(command === "start" ? ["taskStarted:b"] : []),
      ]);
      expect(eventOf(onEvent, "taskStopped")).toMatchObject({ reason: "finished" });
    },
  );

  const conditional = defineChecklists({
    tasks: { a: { walkthrough: [{}], isComplete: (c: { ready: boolean }) => c.ready }, b: { walkthrough: [{}] } },
    checklists: { all: ["a", "b"] },
  });

  it("still requires the completion condition when a subscriber starts another task", () => {
    const onEvent = vi.fn();
    const run = createRun({ context: { ready: false }, onEvent });
    const all = run.checklist(conditional.checklists.all);
    all.start("a");
    run.subscribe(() => {
      if (progressOf(run, "a")?.status === "finished") all.start("b");
    });
    onEvent.mockClear();

    run.act("advance");
    expect(statuses(all)["a"]).toBe("todo");
    expect(run.getSnapshot().open?.task).toBe("b");
    expect(taskEvents(onEvent)).toEqual(["taskStopped:a", "taskStarted:b"]);

    run.setContext({ ready: true });
    expect(statuses(all)["a"]).toBe("done");
    expect(run.getSnapshot().open?.task).toBe("b");
  });

  it("keeps a skip made on seeing a walkthrough finish when the task has a completion condition", () => {
    const onEvent = vi.fn();
    const run = createRun({ context: { ready: false }, onEvent });
    const all = run.checklist(conditional.checklists.all);
    all.start("a");
    run.subscribe(() => {
      if (progressOf(run, "a")?.status === "finished") all.skip("a");
    });
    onEvent.mockClear();

    run.act("advance");
    expect(statuses(all)["a"]).toBe("skipped");
    expect(taskEvents(onEvent)).toEqual(["taskStopped:a", "taskSkipped:a"]);
    expect(eventOf(onEvent, "taskStopped")).toMatchObject({ reason: "finished" });
  });

  it("starts another task from an onEvent handler without confusing the Run", () => {
    const events: string[] = [];
    const run: ReturnType<typeof createRun> = createRun({
      onEvent: (event) => {
        if ("walkthrough" in event) {
          if (event.type === "finish" && run.getSnapshot().open === null) all.start("b");
          return;
        }
        events.push(`${event.type}:${"task" in event ? event.task.id : event.checklist}`);
      },
    });
    const all = run.checklist(pair.checklists.all);
    all.start("a");
    run.act("advance");
    expect(run.getSnapshot().open?.task).toBe("b");
    expect(events).toEqual([
      "taskStarted:a",
      "taskStopped:a",
      "taskComplete:a",
      "checklistComplete:first",
      "taskStarted:b",
    ]);
  });
});

describe("a task written in its own file", () => {
  it("is used unchanged by a checklist", () => {
    const task = { walkthrough: guide, isComplete: (c) => c.hasDeck } satisfies Task<Context>;
    const defined = defineChecklists({ tasks: { deck: task }, checklists: { all: ["deck"] } });
    const all = createRun({ context: { hasDeck: true, hasPhoto: false } }).checklist(defined.checklists.all);
    expect(all.getSnapshot().tasks[0]!.task.walkthrough).toBe(guide);
    all.subscribe(() => {});
    expect(statuses(all)).toEqual({ deck: "done" });
  });

  it("finds its waymark once a checklist starts it", () => {
    const { flush } = fakeFrames();
    addTarget("save");
    const { run, decks } = setup();
    watch(run);
    decks.start("create-deck");
    flush();
    expect(run.getSnapshot().open?.snapshot.waymark.status).toBe("found");
  });
});
