import { describe, expect, it, vi } from "vitest";
import { defineChecklists } from "./checklists";
import { createRun } from "../run/run";
import type { RunOptions, WaymarkEvent } from "../run/types";
import type { StoredRecord } from "../storage/records";
import { everyProblem } from "../problems";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import { localKey } from "../test/dom";
import { held, later } from "../test/storage";

const tour = defineWalkthrough({ id: "tour", steps: [{}, {}, {}] });

const onboarding = defineChecklists({
  tasks: {
    tour: { walkthrough: tour },
    hello: {},
    invite: {},
    met: { isComplete: (context: { met: boolean }) => context.met },
  },
  checklists: { home: ["tour", "hello", "invite", "met"], side: ["tour"] },
});

const saved = (tasks: StoredRecord["tasks"], walkthroughs: StoredRecord["walkthroughs"] = {}): StoredRecord => ({
  version: 4,
  walkthroughs,
  tasks,
});

/** A Run with the home checklist in use. */
const create = (options: RunOptions = {}) => {
  const run = createRun({ context: { met: false }, ...options });
  const home = run.checklist(onboarding.checklists.home);
  home.subscribe(() => {});
  return { run, home };
};

const statuses = ({ home }: ReturnType<typeof create>) =>
  Object.fromEntries(home.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

const events = (onEvent: { mock: { calls: unknown[][] } }) =>
  onEvent.mock.calls.map(([event]) => {
    const e = event as WaymarkEvent;
    return "task" in e ? `${e.type}:${e.task.id}` : e.type;
  });

describe("checklists storage", () => {
  it("reads a synchronous adapter at creation, with no loading state", () => {
    const storage = held(saved({ hello: "done" }));
    const created = create({ storage });
    expect(created.run.getSnapshot().storageStatus).toBe("ready");
    expect(created.home.getSnapshot().storageStatus).toBe("ready");
    expect(statuses(created)).toMatchObject({ hello: "done", invite: "todo" });
  });

  it("saves each change as only what changed, and hands onChange the whole record", () => {
    const storage = held(saved({ invite: "skipped" }));
    const onChange = vi.fn();
    const { home } = create({ storage, onChange });
    home.markDone("hello");
    expect(storage.save).toHaveBeenLastCalledWith({ version: 4, walkthroughs: {}, tasks: { hello: "done" } });
    expect(storage.stored()).toEqual(saved({ invite: "skipped", hello: "done" }));
    expect(onChange).toHaveBeenLastCalledWith(saved({ invite: "skipped", hello: "done" }));

    home.markTodo("hello");
    expect(storage.save).toHaveBeenLastCalledWith({ version: 4, walkthroughs: {}, tasks: { hello: null } });
    expect(storage.stored()).toEqual(saved({ invite: "skipped" }));
  });

  it("is loading until a Promise settles, then shows the statuses without announcing them", async () => {
    const { adapter, answer } = later(saved({ hello: "done", invite: "skipped" }));
    const onEvent = vi.fn();
    const created = create({ storage: adapter, onEvent });
    const listener = vi.fn();
    created.home.subscribe(listener);
    expect(created.home.getSnapshot().storageStatus).toBe("loading");
    expect(statuses(created)).toMatchObject({ hello: "todo", invite: "todo" });

    await answer();

    expect(created.run.getSnapshot().storageStatus).toBe("ready");
    expect(statuses(created)).toMatchObject({ hello: "done", invite: "skipped" });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ storageStatus: "ready", finishedCount: 2 }),
    );
    expect(onEvent).not.toHaveBeenCalled();
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("holds commands while loading and runs them on the stored statuses, in order", async () => {
    const { adapter, answer, stored } = later(saved({ hello: "done", invite: "done" }));
    const onEvent = vi.fn();
    const created = create({ storage: adapter, onEvent });
    const { home } = created;

    // On the empty record these would skip `hello` and leave `invite` done.
    home.skip("hello");
    home.markTodo("invite");
    home.toggle("met");
    expect(statuses(created)).toMatchObject({ hello: "todo", invite: "todo", met: "todo" });
    expect(adapter.save).not.toHaveBeenCalled();

    await answer();

    expect(statuses(created)).toMatchObject({ hello: "done", invite: "todo", met: "done" });
    expect(events(onEvent)).toEqual(["taskReopened:invite", "taskComplete:met"]);
    expect(stored()).toEqual(saved({ hello: "done", met: "done" }));
  });

  it("holds a start, so a task's walkthrough started on page load picks up where the user left it", async () => {
    const stored = { status: "running", step: 2, stepCount: 3, collapsed: true, changedAt: Date.now() } as const;
    const { adapter, answer } = later(saved({}, { tour: stored }));
    const { run, home } = create({ storage: adapter });
    home.start("tour");
    expect(run.getSnapshot().open).toBeNull();

    await answer();
    expect(run.getSnapshot().open).toMatchObject({ task: "tour", snapshot: { stepIndex: 2 } });
  });

  it("checks the latest context once the statuses are in, not before", async () => {
    const { adapter, answer, stored } = later(saved({}));
    const onEvent = vi.fn();
    const created = create({ storage: adapter, onEvent });
    created.run.setContext({ met: true });
    expect(statuses(created)).toMatchObject({ met: "todo" });

    await answer();
    expect(statuses(created)).toMatchObject({ met: "done" });
    expect(onEvent).not.toHaveBeenCalled();
    expect(adapter.save).toHaveBeenCalledOnce();
    expect(stored()).toEqual(saved({ met: "done" }));
  });

  it("reports a failed load, starts empty with an error status, and saves only what it changed", async () => {
    const { adapter, refuse } = later();
    const onProblem = vi.fn();
    const created = create({ storage: adapter, context: { met: true }, problemHandlers: everyProblem(onProblem) });
    const offline = new Error("offline");

    await refuse(offline);

    expect(onProblem).toHaveBeenCalledExactlyOnceWith({ type: "storageFailed", error: offline });
    expect(created.home.getSnapshot().storageStatus).toBe("error");
    expect(statuses(created)).toMatchObject({ met: "done" });
    expect(adapter.save).toHaveBeenCalledExactlyOnceWith({ version: 4, walkthroughs: {}, tasks: { met: "done" } });
  });

  it("never saves over a record it cannot read, and reports each save that could not land", () => {
    const newer = { version: 5, tasks: { hello: "done" } } as unknown as StoredRecord;
    const storage = held(newer);
    const onProblem = vi.fn();
    const created = create({ storage, problemHandlers: everyProblem(onProblem), context: { met: true } });
    expect(statuses(created)).toMatchObject({ met: "done" });

    created.home.markDone("invite");
    expect(statuses(created)).toMatchObject({ met: "done", invite: "done" });
    expect(storage.stored()).toBe(newer);
    expect(onProblem.mock.calls.map(([problem]) => (problem as { type: string }).type)).toEqual([
      "recordUnreadable",
      "storageFailed",
      "storageFailed",
    ]);
  });

  it("reports each record it cannot read", () => {
    const onProblem = vi.fn();
    for (const value of ["text", [], { version: 4 }, { version: 4, walkthroughs: {}, tasks: { a: "finished" } }, { version: 3 }]) {
      onProblem.mockClear();
      createRun({ storage: held(value as unknown as StoredRecord), problemHandlers: everyProblem(onProblem) });
      expect(onProblem).toHaveBeenCalledExactlyOnceWith({
        type: "recordUnreadable",
        error: expect.objectContaining({ message: expect.stringMatching(/not one Waymark wrote/) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
      });
    }
  });

  it.each([
    ["2", { version: 2, record: { hello: "skipped" } }],
    ["3", { version: 3, tasks: { hello: "skipped" } }],
  ])("reads the version %s record the old task storage wrote, and saves it as one record", (_, old) => {
    const key = localKey("app");
    localStorage.setItem(key, JSON.stringify(old));
    const created = create({ storage: key });
    expect(statuses(created)).toMatchObject({ hello: "skipped" });
    created.home.markDone("invite");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(saved({ hello: "skipped", invite: "done" }));
  });

  it("follows statuses another tab changes through a localStorage key", () => {
    const key = localKey("app");
    const created = create({ storage: key });
    const other = JSON.stringify(saved({ invite: "done" }));
    localStorage.setItem(key, other);
    globalThis.dispatchEvent(new StorageEvent("storage", { key, newValue: other, storageArea: localStorage }));
    expect(statuses(created)).toMatchObject({ invite: "done" });

    globalThis.dispatchEvent(new StorageEvent("storage", { key: "elsewhere", newValue: "{}", storageArea: localStorage }));
    expect(statuses(created)).toMatchObject({ invite: "done" });
  });

  it("gives a server snapshot from before storage was read", () => {
    const { home } = create({ storage: held(saved({ hello: "done" })), context: { met: true } });
    expect(home.getSnapshot()).toMatchObject({ storageStatus: "ready", finishedCount: 2 });
    expect(home.getServerSnapshot()).toMatchObject({ storageStatus: "loading", finishedCount: 0 });

    // Nothing to read: the server shows what the client will.
    const plain = createRun({ initial: saved({ hello: "done" }) }).checklist(onboarding.checklists.home);
    expect(plain.getServerSnapshot()).toEqual(plain.getSnapshot());
  });

  it("keeps a task's walkthrough under a localStorage key, and picks it up once its checklist is used after a reload", () => {
    const key = localKey("place");
    const first = create({ storage: key });
    first.home.start("tour");
    first.run.act("advance");
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ walkthroughs: { tour: { step: 1 } } });

    const reloaded = createRun({ storage: key });
    expect(reloaded.getSnapshot().open).toBeNull();
    reloaded.checklist(onboarding.checklists.side).subscribe(() => {});
    expect(reloaded.getSnapshot().open).toMatchObject({ task: "tour", snapshot: { stepIndex: 1 } });
  });
});
