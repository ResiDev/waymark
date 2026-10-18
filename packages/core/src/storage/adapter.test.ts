import { describe, expect, it, vi } from "vitest";
import { localStorageAdapter } from "./adapter";
import { defineChecklists } from "../checklists/checklists";
import { everyProblem } from "../problems";
import { localKey } from "../test/dom";
import { connected } from "../test/run";

const statuses = (view: { getSnapshot: () => { tasks: readonly { task: { id: string }; status: string }[] } }) =>
  Object.fromEntries(view.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

describe("localStorageAdapter", () => {
  it.each(["constructor", "toString", "__proto__"])("keeps the status of a Task named %s across a reload", (id) => {
    const key = localKey("setup");
    const tasks = { [id]: {}, other: {} };
    const definition = defineChecklists({ tasks }).checklists.main;
    connected({ storage: localStorageAdapter(key) }).checklist(definition).skip(id);
    const reloaded = connected({ storage: localStorageAdapter(key) }).checklist(definition);
    expect(statuses(reloaded)).toEqual({ [id]: "skipped", other: "todo" });
  });

  it("writes JSON under its name, and removes the key once nothing is left", () => {
    const key = localKey("setup");
    const main = connected({ storage: localStorageAdapter(key) }).checklist(defineChecklists({ tasks: { a: {} } }).checklists.main);
    main.markDone("a");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, walkthroughs: {}, tasks: { a: "done" } });
    main.markTodo("a");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("saves only what changed, leaving what another tab wrote since", () => {
    const key = localKey("setup");
    const main = connected({ storage: localStorageAdapter(key) }).checklist(defineChecklists({ tasks: { a: {}, b: {} } }).checklists.main);
    localStorage.setItem(key, JSON.stringify({ version: 1, walkthroughs: {}, tasks: { b: "skipped" } }));
    main.markDone("a");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, walkthroughs: {}, tasks: { a: "done", b: "skipped" } });
  });

  it("hands text that is not JSON on, to be reported as a record Waymark did not write", () => {
    const key = localKey("setup");
    localStorage.setItem(key, "not json");
    const onProblem = vi.fn();
    const run = connected({ storage: localStorageAdapter(key), problemHandlers: everyProblem(onProblem) });
    expect(run.getSnapshot().storageStatus).toBe("error");
    expect(onProblem).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "recordUnreadable",
        error: expect.objectContaining({ message: expect.stringMatching(/not one Waymark wrote/) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
        stored: "not json",
      }),
    );
  });

  it("lets core report blocked storage, and keeps progress in memory", () => {
    const blocked = new Error("blocked");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw blocked;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw blocked;
    });
    const onProblem = vi.fn();
    const run = connected({ storage: localStorageAdapter("setup"), problemHandlers: everyProblem(onProblem) });
    const main = run.checklist(defineChecklists({ tasks: { a: {} } }).checklists.main);
    main.markDone("a");
    expect(statuses(main)).toEqual({ a: "done" });
    const failed = { type: "storageFailed", error: blocked };
    expect(onProblem.mock.calls).toEqual([[failed], [failed]]);
  });

  it("stops hearing other tabs once unsubscribed", () => {
    const key = localKey("other-tab");
    const listener = vi.fn();
    const stop = localStorageAdapter(key).subscribe!(listener);
    // As another tab would: write, then tell this one.
    const hear = (newValue: string | null) => {
      if (newValue === null) localStorage.clear();
      else localStorage.setItem(key, newValue);
      globalThis.dispatchEvent(new StorageEvent("storage", { key: newValue === null ? null : key, newValue, storageArea: localStorage }));
    };

    hear('{"version":1,"walkthroughs":{},"tasks":{}}');
    hear(null);
    expect(listener.mock.calls).toEqual([[{ version: 1, walkthroughs: {}, tasks: {} }], [null]]);

    stop();
    hear("{}");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
