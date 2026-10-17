import { describe, expect, it, vi } from "vitest";
import { localStorageAdapter } from "./adapter";
import type { StoredRecord } from "./records";
import { defineChecklists } from "../checklists/checklists";
import { createRun } from "../run/run";
import { everyProblem } from "../problems";
import { localKey } from "../test/dom";

const statuses = (view: { getSnapshot: () => { tasks: readonly { task: { id: string }; status: string }[] } }) =>
  Object.fromEntries(view.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

describe("localStorageAdapter", () => {
  it.each(["constructor", "toString", "__proto__"])("keeps the status of a Task named %s across a reload", (id) => {
    const key = localKey("setup");
    const tasks = { [id]: {}, other: {} };
    const definition = defineChecklists({ tasks }).checklists.main;
    createRun({ storage: localStorageAdapter(key) }).checklist(definition).skip(id);
    const reloaded = createRun({ storage: localStorageAdapter(key) }).checklist(definition);
    expect(statuses(reloaded)).toEqual({ [id]: "skipped", other: "todo" });
  });

  it("writes JSON under its name, and removes the key once nothing is left", () => {
    const key = localKey("setup");
    const main = createRun({ storage: localStorageAdapter(key) }).checklist(defineChecklists({ tasks: { a: {} } }).checklists.main);
    main.markDone("a");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 4, walkthroughs: {}, tasks: { a: "done" } });
    main.markTodo("a");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("hands text that is not JSON on, to be reported as a record Waymark did not write", () => {
    const key = localKey("setup");
    localStorage.setItem(key, "not json");
    const onProblem = vi.fn();
    const run = createRun({ storage: localStorageAdapter<StoredRecord>(key), problemHandlers: everyProblem(onProblem) });
    expect(run.getSnapshot().storageStatus).toBe("error");
    expect(onProblem).toHaveBeenCalledExactlyOnceWith({
      type: "recordUnreadable",
      error: expect.objectContaining({ message: expect.stringMatching(/not one Waymark wrote/) }), // oxlint-disable-line typescript/no-unsafe-assignment -- Vitest types its asymmetric matchers as any.
    });
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
    const run = createRun({ storage: localStorageAdapter("setup"), problemHandlers: everyProblem(onProblem) });
    const main = run.checklist(defineChecklists({ tasks: { a: {} } }).checklists.main);
    main.markDone("a");
    expect(statuses(main)).toEqual({ a: "done" });
    const failed = { type: "storageFailed", error: blocked };
    expect(onProblem.mock.calls).toEqual([[failed], [failed]]);
  });

  it("stops hearing other tabs once unsubscribed", () => {
    const listener = vi.fn();
    const stop = localStorageAdapter("other-tab").subscribe!(listener);
    const hear = (key: string | null, newValue: string | null) =>
      globalThis.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));

    hear("other-tab", '{"version":4,"walkthroughs":{},"tasks":{}}');
    hear(null, null);
    expect(listener.mock.calls).toEqual([[{ version: 4, walkthroughs: {}, tasks: {} }], [null]]);

    stop();
    hear("other-tab", "{}");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
