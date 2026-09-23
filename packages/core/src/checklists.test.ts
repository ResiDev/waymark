import { describe, expect, it, vi } from "vitest";
import { createChecklists, defineTask } from "./checklists";
import type { ChecklistsEvent, Stored } from "./checklists";
import { defineWalkthrough } from "./walkthrough";

const guide = defineWalkthrough([{ waymark: "save" }, {}]);
const single = defineWalkthrough([{}]);

const context = { hasDeck: false, hasPhoto: false };
type Context = typeof context;

type Options = {
  stored?: Stored;
  onChange?: (stored: Stored) => void;
  onEvent?: (event: ChecklistsEvent<any, any>) => void;
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
    const e = event as ChecklistsEvent<any, any>;
    return "task" in e ? `${e.type}:${e.task.id}` : `${e.type}:${e.checklist}`;
  });

const finish = (run: { act: (action: "advance") => void }, steps: number) => {
  for (let i = 0; i < steps; i++) run.act("advance");
};

describe("createChecklists", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "supports %s as both a task id and checklist name",
    (name) => {
      const onChange = vi.fn();
      const owner = createChecklists({
        context: {},
        tasks: { [name]: { walkthrough: single } },
        checklists: { [name]: [name] },
        onChange,
      });
      const view = owner.checklists[name]!;
      expect(Object.hasOwn(owner.checklists, name)).toBe(true);
      expect(view.getSnapshot().tasks[0]).toMatchObject({ task: { id: name }, status: "todo" });

      view.start(name);
      expect(owner.getSnapshot().active?.task.id).toBe(name);
      view.skip(name);
      expect(view.getSnapshot().tasks[0]!.status).toBe("skipped");
      const stored = onChange.mock.calls[0]![0];
      expect(Object.hasOwn(stored.skipped, name)).toBe(true);
      expect(stored.skipped[name]).toEqual([name]);

      owner.clear();
      owner.load(JSON.parse(JSON.stringify(stored)));
      expect(view.getSnapshot().tasks[0]!.status).toBe("skipped");
      view.markDone(name);
      expect(view.getSnapshot().tasks[0]!.status).toBe("done");
      expect(onChange.mock.lastCall![0]).toEqual({ done: [name], skipped: {} });
    },
  );

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
  });

  it("shows every task of a selection in its order, with its id and definition", () => {
    const owner = setup();
    const rows = owner.checklists.home.getSnapshot().tasks;
    expect(rows.map((row) => row.task.id)).toEqual(["add-photo", "create-deck", "read-tips", "say-hello"]);
    const deck = rows[1]!.task;
    if (deck.id !== "create-deck") throw new Error("expected create-deck");
    expect(deck.walkthrough).toBe(guide);
    expect(rows[1]!.status).toBe("todo");
    expect(owner.checklists.decks.getSnapshot()).toMatchObject({
      finishedCount: 0,
      taskCount: 1,
      complete: false,
      active: null,
    });
  });

  it("records matching conditions at creation, saving but announcing nothing", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const owner = setup({ context: { hasDeck: true, hasPhoto: false }, onChange, onEvent });
    expect(statuses(owner.checklists.decks)).toEqual({ "create-deck": "done" });
    expect(owner.checklists.decks.getSnapshot().complete).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ done: ["create-deck"], skipped: {} });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("does not save a difference that is only normalisation", () => {
    const onChange = vi.fn();
    const owner = setup({
      stored: { done: ["read-tips", "read-tips", "ghost"], skipped: { home: ["read-tips", "say-hello"] } },
      onChange,
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(statuses(owner.checklists.home)).toMatchObject({ "read-tips": "done", "say-hello": "skipped" });

    owner.markDone("say-hello");
    // Known ids in task order, the unknown one after; done wins over skipped.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      done: ["read-tips", "say-hello", "ghost"],
      skipped: {},
    });
  });

  it("preserves unknown ids and names across local changes, in input order", () => {
    const onChange = vi.fn();
    const owner = setup({
      stored: { done: ["zeta", "alpha"], skipped: { archive: ["gone"], home: ["say-hello"] } },
      onChange,
    });
    owner.checklists.decks.skip("create-deck");
    expect(onChange).toHaveBeenLastCalledWith({
      done: ["zeta", "alpha"],
      skipped: { home: ["say-hello"], decks: ["create-deck"], archive: ["gone"] },
    });
  });
});

describe("update", () => {
  it("records done in every view, once, and announces task then checklist completion", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const owner = setup({ onChange, onEvent });
    const home = vi.fn();
    const decks = vi.fn();
    owner.checklists.home.subscribe(home);
    owner.checklists.decks.subscribe(decks);

    owner.update({ hasDeck: true, hasPhoto: false });

    expect(statuses(owner.checklists.home)["create-deck"]).toBe("done");
    expect(statuses(owner.checklists.decks)["create-deck"]).toBe("done");
    expect(home).toHaveBeenCalledOnce();
    expect(decks).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ done: ["create-deck"], skipped: {} });
    expect(types(onEvent)).toEqual(["taskComplete:create-deck", "checklistComplete:decks"]);
    const complete = onEvent.mock.calls[1]![0] as Extract<ChecklistsEvent<any, any>, { type: "checklistComplete" }>;
    expect(complete.snapshot).toBe(owner.checklists.decks.getSnapshot());
    expect(complete.snapshot.finishedCount).toBe(1);
  });

  it("checks in task map order and commits everything together", () => {
    const seen: string[] = [];
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const owner = createChecklists({
      context: { ready: false },
      tasks: {
        b: { isComplete: (c) => (seen.push("b"), c.ready) },
        a: { isComplete: (c) => (seen.push("a"), c.ready) },
      },
      checklists: { all: ["a", "b"] },
      stored: { done: ["unknown-task"], skipped: { all: ["a"], retired: ["b", "unknown-skipped"] } },
      onEvent,
      onChange,
    });
    const listener = vi.fn();
    owner.checklists.all.subscribe(listener);
    seen.length = 0;

    owner.update({ ready: true });
    expect(seen).toEqual(["b", "a"]);
    expect(listener).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      done: ["b", "a", "unknown-task"],
      skipped: { retired: ["unknown-skipped"] },
    });
    expect(types(onEvent)).toEqual(["taskComplete:b", "taskComplete:a", "checklistComplete:all"]);
  });

  it("leaves done tasks alone and does not re-check them", () => {
    const isComplete = vi.fn((c: { ready: boolean }) => c.ready);
    const owner = createChecklists({
      context: { ready: true },
      tasks: { a: { isComplete } },
      checklists: { all: ["a"] },
    });
    isComplete.mockClear();
    owner.update({ ready: false });
    expect(isComplete).not.toHaveBeenCalled();
    expect(statuses(owner.checklists.all)).toEqual({ a: "done" });
  });

  it("lets done override skipped everywhere without repeating a view's completion", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    owner.checklists.decks.skip("create-deck");
    expect(types(onEvent)).toEqual(["taskSkipped:create-deck", "checklistComplete:decks"]);
    onEvent.mockClear();

    owner.update({ hasDeck: true, hasPhoto: false });
    expect(statuses(owner.checklists.decks)).toEqual({ "create-deck": "done" });
    expect(types(onEvent)).toEqual(["taskComplete:create-deck"]);
  });

  it("records nothing when a condition throws", () => {
    const owner = createChecklists({
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
    expect(() => owner.update({ ready: true })).toThrow("boom");
    expect(statuses(owner.checklists.all)).toEqual({ a: "todo", b: "todo" });
  });

  it("keeps an unaffected view's snapshot identity", () => {
    const owner = setup();
    const decksBefore = owner.checklists.decks.getSnapshot();
    const homeBefore = owner.checklists.home.getSnapshot();
    owner.update({ hasDeck: false, hasPhoto: true });
    expect(owner.checklists.decks.getSnapshot()).toBe(decksBefore);
    expect(owner.checklists.home.getSnapshot()).not.toBe(homeBefore);
  });
});

describe("guidance", () => {
  it("starts a Run, shows it in every view holding the task, and exits it on stop", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    const ownerListener = vi.fn();
    owner.subscribe(ownerListener);
    const before = owner.getSnapshot();

    owner.checklists.decks.start("create-deck");

    const active = owner.getSnapshot().active!;
    expect(active.task.id).toBe("create-deck");
    expect(active.run.getSnapshot()).toMatchObject({ phase: "running", stepIndex: 0 });
    expect(owner.getSnapshot()).not.toBe(before);
    expect(ownerListener).toHaveBeenCalledOnce();
    expect(owner.checklists.home.getSnapshot().active).toBe(active);
    expect(owner.checklists.decks.getSnapshot().active).toBe(active);
    expect(types(onEvent)).toEqual(["taskStarted:create-deck"]);

    // Starting the active task again changes nothing.
    owner.start("create-deck");
    expect(owner.getSnapshot().active).toBe(active);
    expect(ownerListener).toHaveBeenCalledOnce();

    owner.stop();
    expect(owner.getSnapshot().active).toBeNull();
    expect(active.run.getSnapshot().phase).toBe("exited");
    expect(types(onEvent)).toEqual(["taskStarted:create-deck", "taskStopped:create-deck"]);
    expect(onEvent.mock.calls[1]![0]).toMatchObject({ reason: "stopped" });

    owner.stop();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("records the checklists a Run counts for, so a renderer can skip the task in them", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const owner = setup({ onEvent, onChange });
    owner.checklists.decks.start("create-deck");

    const active = owner.getSnapshot().active!;
    expect(active.checklists).toEqual(["decks"]);
    expect(owner.checklists.home.getSnapshot().active).toBe(active);

    // A renderer's "skip task".
    owner.skipActive(active.run);
    expect(statuses(owner.checklists.decks)["create-deck"]).toBe("skipped");
    expect(statuses(owner.checklists.home)["create-deck"]).toBe("todo");
    expect(active.run.getSnapshot().phase).toBe("exited");
    expect(onChange).toHaveBeenCalledOnce();
    expect(types(onEvent)).toEqual([
      "taskStarted:create-deck",
      "taskSkipped:create-deck",
      "taskStopped:create-deck",
      "checklistComplete:decks",
    ]);
    expect(onEvent.mock.calls[2]![0]).toMatchObject({ reason: "skipped" });
  });

  it("takes the checklists a Run counts for from the application", () => {
    const owner = setup();
    owner.start("create-deck");
    expect(owner.getSnapshot().active!.checklists).toEqual([]);
    owner.start("add-photo", "home");
    expect(owner.getSnapshot().active!.checklists).toEqual(["home"]);
    owner.start("create-deck", ["home", "decks", "home"]);
    expect(owner.getSnapshot().active!.checklists).toEqual(["home", "decks"]);
  });

  it("skips in several checklists as one change", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const owner = setup({ onEvent, onChange });
    owner.start("create-deck", ["home", "decks"]);
    const { run } = owner.getSnapshot().active!;
    onEvent.mockClear();

    owner.skipActive(run);
    expect(statuses(owner.checklists.home)["create-deck"]).toBe("skipped");
    expect(statuses(owner.checklists.decks)["create-deck"]).toBe("skipped");
    expect(run.getSnapshot().phase).toBe("exited");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]![0].skipped).toEqual({
      home: ["create-deck"],
      decks: ["create-deck"],
    });
    expect(types(onEvent)).toEqual([
      "taskSkipped:create-deck",
      "taskSkipped:create-deck",
      "taskStopped:create-deck",
      "checklistComplete:decks",
    ]);
    expect(onEvent.mock.calls.slice(0, 2).map(([e]) => e.checklist)).toEqual(["home", "decks"]);
  });

  it("skips the active task in nothing when its Run counts for no checklists", () => {
    const onChange = vi.fn();
    const owner = setup({ onChange });
    owner.start("create-deck");
    const active = owner.getSnapshot().active;
    owner.skipActive(active!.run);
    expect(owner.getSnapshot().active).toBe(active);
    expect(active!.run.getSnapshot().phase).not.toBe("exited");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("skips nothing for a Run that is no longer active", () => {
    const onChange = vi.fn();
    const owner = setup({ onChange });
    owner.checklists.decks.start("create-deck");
    const first = owner.getSnapshot().active!.run;
    owner.skipActive(first);
    expect(onChange).toHaveBeenCalledOnce();

    // A second press after guidance moved on, or a replay of the same task.
    owner.checklists.home.start("add-photo");
    owner.skipActive(first);
    owner.stop();
    owner.checklists.decks.start("create-deck");
    const replay = owner.getSnapshot().active;
    owner.skipActive(first);
    expect(statuses(owner.checklists.home)["add-photo"]).toBe("todo");
    expect(owner.getSnapshot().active).toBe(replay);
    expect(onChange).toHaveBeenCalledOnce();

    owner.stop();
    owner.skipActive(first);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("checks the Run is still active when the command runs, not when it was sent", () => {
    const owner = setup();
    owner.checklists.decks.start("create-deck");
    const { run } = owner.getSnapshot().active!;
    // Sent while create-deck is active, queued behind a start of add-photo.
    const unsubscribe = owner.checklists.home.subscribe(() => {
      unsubscribe();
      owner.checklists.home.start("add-photo");
      owner.skipActive(run);
    });
    owner.markDone("say-hello");
    expect(statuses(owner.checklists.decks)["create-deck"]).toBe("todo");
    expect(owner.getSnapshot().active!.task.id).toBe("add-photo");
  });

  it("rejects a checklist that does not exist or does not select the task", () => {
    const owner = setup() as unknown as {
      start: (id: string, checklists?: string | readonly string[]) => void;
    };
    expect(() => owner.start("add-photo", "decks")).toThrow(/Checklist "decks" does not select task "add-photo"/);
    expect(() => owner.start("add-photo", ["home", "nope"])).toThrow(/Unknown checklist "nope"/);
  });

  it("keeps the first checklists when the task already active is started again", () => {
    const owner = setup();
    owner.checklists.decks.start("create-deck");
    const active = owner.getSnapshot().active;
    owner.start("create-deck", "home");
    expect(owner.getSnapshot().active).toBe(active);
    expect(active!.checklists).toEqual(["decks"]);
  });

  it("hides the Run from views that do not hold its task", () => {
    const owner = setup();
    owner.start("add-photo");
    expect(owner.checklists.home.getSnapshot().active?.task.id).toBe("add-photo");
    expect(owner.checklists.decks.getSnapshot().active).toBeNull();
  });

  it("ignores tasks without a walkthrough", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    owner.start("say-hello");
    expect(owner.getSnapshot().active).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("replaces the previous Run when another task starts", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    owner.start("create-deck");
    const first = owner.getSnapshot().active!.run;
    onEvent.mockClear();

    owner.start("add-photo");
    expect(first.getSnapshot().phase).toBe("exited");
    expect(owner.getSnapshot().active?.task.id).toBe("add-photo");
    expect(types(onEvent)).toEqual(["taskStopped:create-deck", "taskStarted:add-photo"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "stopped" });
  });

  it("marks a task without a condition done when its Run finishes", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const owner = setup({ onEvent, onChange });
    owner.start("read-tips");
    const { run } = owner.getSnapshot().active!;
    onEvent.mockClear();

    finish(run, 1);

    expect(owner.getSnapshot().active).toBeNull();
    expect(statuses(owner.checklists.home)["read-tips"]).toBe("done");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ done: ["read-tips"], skipped: {} });
    expect(types(onEvent)).toEqual(["taskStopped:read-tips", "taskComplete:read-tips"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "finished" });
  });

  it("does not repeat completion when a done task's Run is replayed to the end", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    owner.markDone("read-tips");
    owner.start("read-tips");
    onEvent.mockClear();
    finish(owner.getSnapshot().active!.run, 1);
    expect(types(onEvent)).toEqual(["taskStopped:read-tips"]);
  });

  it("leaves completion to the condition when a guided task finishes", () => {
    const owner = setup();
    owner.start("create-deck");
    finish(owner.getSnapshot().active!.run, 2);
    expect(owner.getSnapshot().active).toBeNull();
    expect(statuses(owner.checklists.decks)).toEqual({ "create-deck": "todo" });
  });

  it("clears active when the Run exits from its own UI, keeping progress", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    owner.markDone("add-photo");
    owner.start("add-photo");
    onEvent.mockClear();

    owner.getSnapshot().active!.run.act("exit");

    expect(owner.getSnapshot().active).toBeNull();
    expect(statuses(owner.checklists.home)["add-photo"]).toBe("done");
    expect(types(onEvent)).toEqual(["taskStopped:add-photo"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "stopped" });
  });

  it("handles finish before the supplied Run listener sees it, and gives Runs the bound UI", () => {
    const seen: string[] = [];
    const dialog = document.createElement("div");
    const owner = createChecklists({
      context: {},
      tasks: { tips: { walkthrough: single } },
      checklists: { all: ["tips"] },
      onEvent: (event) => seen.push(`owner:${event.type}`),
      run: {
        waymarkPadding: 12,
        onEvent: (event) => {
          seen.push(`run:${event.type}`);
          if (event.type === "finish") seen.push(`active:${String(owner.getSnapshot().active)}`);
        },
      },
    });
    expect(owner.waymarkPadding).toBe(12);
    const release = owner.bindUi(() => ({ dialog, beacon: null }));

    owner.start("tips");
    const { run } = owner.getSnapshot().active!;
    const stop = run.subscribe(() => {});
    // A click on the bound dialog is a click on the walkthrough's UI, not away.
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run.getSnapshot()).toMatchObject({ collapsed: false });
    release();
    document.body.append(dialog);
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run.getSnapshot()).toMatchObject({ collapsed: true });
    stop();

    seen.length = 0;
    run.act("advance");
    expect(seen).toEqual([
      "run:advance",
      "owner:taskStopped",
      "owner:taskComplete",
      "owner:checklistComplete",
      "run:finish",
      "active:null",
    ]);
  });

  it("lets the newest UI binding win and releases only its own", () => {
    const owner = setup();
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    const releaseA = owner.bindUi(() => ({ dialog: a, beacon: null }));
    owner.bindUi(() => ({ dialog: b, beacon: null }));
    owner.start("read-tips");
    const { run } = owner.getSnapshot().active!;
    const stop = run.subscribe(() => {});

    releaseA();
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(run.getSnapshot()).toMatchObject({ collapsed: false });
    stop();
  });
});

describe("markDone and skip", () => {
  it("records done everywhere and lets guidance continue", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const owner = setup({ onEvent, onChange });
    owner.start("create-deck");
    onEvent.mockClear();

    owner.checklists.home.markDone("create-deck");

    expect(statuses(owner.checklists.decks)).toEqual({ "create-deck": "done" });
    expect(owner.getSnapshot().active?.task.id).toBe("create-deck");
    expect(types(onEvent)).toEqual(["taskComplete:create-deck", "checklistComplete:decks"]);
    expect(onChange).toHaveBeenCalledOnce();

    owner.markDone("create-deck");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("skips in one view only and exits that task's Run", () => {
    const onEvent = vi.fn();
    const onChange = vi.fn();
    const owner = setup({ onEvent, onChange });
    owner.start("create-deck");
    const { run } = owner.getSnapshot().active!;
    onEvent.mockClear();

    owner.checklists.home.skip("create-deck");

    expect(statuses(owner.checklists.home)["create-deck"]).toBe("skipped");
    expect(statuses(owner.checklists.decks)["create-deck"]).toBe("todo");
    expect(owner.getSnapshot().active).toBeNull();
    expect(run.getSnapshot().phase).toBe("exited");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ done: [], skipped: { home: ["create-deck"] } });
    expect(types(onEvent)).toEqual(["taskSkipped:create-deck", "taskStopped:create-deck"]);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ checklist: "home" });
    expect(onEvent.mock.calls[1]![0]).toMatchObject({ reason: "skipped" });

    owner.checklists.home.skip("create-deck");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not skip a done task", () => {
    const onEvent = vi.fn();
    const owner = setup({ onEvent });
    owner.markDone("say-hello");
    onEvent.mockClear();
    owner.checklists.home.skip("say-hello");
    expect(statuses(owner.checklists.home)["say-hello"]).toBe("done");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("counts skipped tasks towards completion", () => {
    const owner = setup();
    owner.checklists.home.skip("add-photo");
    owner.checklists.home.skip("create-deck");
    owner.markDone("read-tips");
    owner.markDone("say-hello");
    expect(owner.checklists.home.getSnapshot()).toMatchObject({
      finishedCount: 4,
      taskCount: 4,
      complete: true,
    });
    expect(owner.checklists.decks.getSnapshot().complete).toBe(false);
  });
});

describe("load and clear", () => {
  it("replaces the record without saving or announcing, and notifies changed views", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const owner = setup({ onChange, onEvent });
    owner.markDone("say-hello");
    const home = vi.fn();
    const decks = vi.fn();
    owner.checklists.home.subscribe(home);
    owner.checklists.decks.subscribe(decks);
    onChange.mockClear();
    onEvent.mockClear();

    owner.load({ done: ["ghost"], skipped: { home: ["add-photo"] } });

    expect(statuses(owner.checklists.home)).toEqual({
      "add-photo": "skipped",
      "create-deck": "todo",
      "read-tips": "todo",
      "say-hello": "todo",
    });
    expect(home).toHaveBeenCalledOnce();
    expect(decks).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();

    // The loaded unknown id survives the next local change.
    owner.markDone("read-tips");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      done: ["read-tips", "ghost"],
      skipped: { home: ["add-photo"] },
    });
  });

  it("clears everything once, keeps the Run, and is a no-op when already empty", () => {
    const onChange = vi.fn();
    const onEvent = vi.fn();
    const owner = setup({ stored: { done: ["ghost"], skipped: { gone: ["x"] } }, onChange, onEvent });
    owner.markDone("say-hello");
    owner.checklists.decks.skip("create-deck");
    owner.start("add-photo");
    const listener = vi.fn();
    owner.checklists.home.subscribe(listener);
    onChange.mockClear();
    onEvent.mockClear();

    owner.clear();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ done: [], skipped: {} });
    expect(onEvent).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    expect(statuses(owner.checklists.home)).toEqual({
      "add-photo": "todo",
      "create-deck": "todo",
      "read-tips": "todo",
      "say-hello": "todo",
    });
    expect(owner.getSnapshot().active?.task.id).toBe("add-photo");

    owner.clear();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not re-check conditions after clear until the next update", () => {
    const owner = setup({ context: { hasDeck: true, hasPhoto: false } });
    owner.clear();
    expect(statuses(owner.checklists.decks)).toEqual({ "create-deck": "todo" });
    owner.update({ hasDeck: true, hasPhoto: false });
    expect(statuses(owner.checklists.decks)).toEqual({ "create-deck": "done" });
  });
});

describe("re-entrancy and errors", () => {
  it("runs a command sent from a listener after the current change is fully announced", () => {
    const order: string[] = [];
    const owner = setup({
      onEvent: (event) => order.push(`event:${event.type}`),
    });
    owner.checklists.home.subscribe(() => {
      order.push(`home:${statuses(owner.checklists.home)["read-tips"]}`);
      if (statuses(owner.checklists.home)["say-hello"] === "todo") owner.markDone("say-hello");
    });

    owner.markDone("read-tips");

    expect(order).toEqual([
      "home:done",
      "event:taskComplete",
      "home:done",
      "event:taskComplete",
    ]);
    expect(statuses(owner.checklists.home)["say-hello"]).toBe("done");
  });

  it("keeps notifying when a listener throws, and reports the errors after", () => {
    const owner = setup();
    const after = vi.fn();
    owner.checklists.home.subscribe(() => {
      throw new Error("first");
    });
    owner.checklists.home.subscribe(() => {
      throw new Error("second");
    });
    owner.checklists.home.subscribe(after);

    expect(() => owner.markDone("say-hello")).toThrow(AggregateError);
    expect(after).toHaveBeenCalledOnce();
    expect(statuses(owner.checklists.home)["say-hello"]).toBe("done");
  });

  it.each(["start", "stop", "skip"] as const)(
    "records completion when a Run subscriber calls %s before the finish event",
    (command) => {
      const onEvent = vi.fn();
      const onChange = vi.fn();
      const owner = createChecklists({
        context: {},
        tasks: { a: { walkthrough: single }, b: { walkthrough: single } },
        checklists: { all: ["a", "b"], first: ["a"] },
        onEvent,
        onChange,
      });
      owner.start("a");
      const run = owner.getSnapshot().active!.run;
      const unsubscribe = run.subscribe(() => {
        if (run.getSnapshot().phase !== "completed") return;
        if (command === "start") owner.start("b");
        else if (command === "stop") owner.stop();
        else owner.checklists.all.skip("a");
      });
      onEvent.mockClear();

      try {
        run.act("advance");
        expect(statuses(owner.checklists.all).a).toBe("done");
        expect(statuses(owner.checklists.first).a).toBe("done");
        expect(owner.getSnapshot().active?.task.id ?? null).toBe(command === "start" ? "b" : null);
        expect(run.getSnapshot().phase).toBe("completed");
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ done: ["a"], skipped: {} });
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
    const owner = createChecklists({
      context: { ready: false },
      tasks: {
        a: { walkthrough: single, isComplete: (c) => c.ready },
        b: { walkthrough: single },
      },
      checklists: { all: ["a", "b"] },
      onEvent,
    });
    owner.start("a");
    const run = owner.getSnapshot().active!.run;
    const unsubscribe = run.subscribe(() => {
      if (run.getSnapshot().phase === "completed") owner.start("b");
    });
    onEvent.mockClear();

    try {
      run.act("advance");
      expect(statuses(owner.checklists.all).a).toBe("todo");
      expect(owner.getSnapshot().active?.task.id).toBe("b");
      expect(types(onEvent)).toEqual(["taskStopped:a", "taskStarted:b"]);
      expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "finished" });

      owner.update({ ready: true });
      expect(statuses(owner.checklists.all).a).toBe("done");
      expect(owner.getSnapshot().active?.task.id).toBe("b");
    } finally {
      unsubscribe();
    }
  });

  it("keeps a skip made from a finished Run when the task has a completion condition", () => {
    const onEvent = vi.fn();
    const owner = createChecklists({
      context: { ready: false },
      tasks: { a: { walkthrough: single, isComplete: (c) => c.ready } },
      checklists: { all: ["a"] },
      onEvent,
    });
    owner.start("a");
    const run = owner.getSnapshot().active!.run;
    const unsubscribe = run.subscribe(() => {
      if (run.getSnapshot().phase === "completed") owner.checklists.all.skip("a");
    });
    onEvent.mockClear();

    try {
      run.act("advance");
      expect(statuses(owner.checklists.all).a).toBe("skipped");
      expect(types(onEvent)).toEqual(["taskStopped:a", "taskSkipped:a", "checklistComplete:all"]);
      expect(onEvent.mock.calls[0]![0]).toMatchObject({ reason: "finished" });
    } finally {
      unsubscribe();
    }
  });

  it("starts another task from a Run listener without confusing the owner", () => {
    const events: string[] = [];
    const owner = createChecklists({
      context: {},
      tasks: { a: { walkthrough: single }, b: { walkthrough: single } },
      checklists: { all: ["a", "b"] },
      onEvent: (event) => events.push(`${event.type}:${"task" in event ? event.task.id : event.checklist}`),
      run: {
        onEvent: (event) => {
          if (event.type === "finish" && owner.getSnapshot().active === null) owner.start("b");
        },
      },
    });
    owner.start("a");
    finish(owner.getSnapshot().active!.run, 1);
    expect(owner.getSnapshot().active?.task.id).toBe("b");
    expect(events).toEqual([
      "taskStarted:a",
      "taskStopped:a",
      "taskComplete:a",
      "taskStarted:b",
    ]);
  });
});

describe("defineTask", () => {
  it("returns the task unchanged for use in another owner", () => {
    const task = defineTask<Context>()({ walkthrough: guide, isComplete: (c) => c.hasDeck });
    const owner = createChecklists({
      context,
      tasks: { deck: task },
      checklists: { all: ["deck"] },
    });
    expect(owner.checklists.all.getSnapshot().tasks[0]!.task.walkthrough).toBe(guide);
  });
});
