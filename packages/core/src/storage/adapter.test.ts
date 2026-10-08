import { describe, expect, it, vi } from "vitest";
import { localStorageAdapter } from "./adapter";
import type { StoredTasks } from "./records";
import { createChecklists } from "../checklists/checklists";
import { localKey } from "../test/dom";

const statuses = (owner: { checklists: { main: { getSnapshot: () => { tasks: readonly { task: { id: string }; status: string }[] } } } }) =>
  Object.fromEntries(owner.checklists.main.getSnapshot().tasks.map((row) => [row.task.id, row.status]));

describe("localStorageAdapter", () => {
  it.each(["constructor", "toString", "__proto__"])("keeps the status of a Task named %s across a reload", (id) => {
    const key = localKey("setup");
    const create = () =>
      createChecklists({ tasks: { [id]: {}, other: {} }, storage: { tasks: localStorageAdapter(key) } });
    create().skip(id);
    expect(statuses(create())).toEqual({ [id]: "skipped", other: "todo" });
  });

  it("writes JSON under its name, and removes the key once nothing is left", () => {
    const key = localKey("setup");
    const owner = createChecklists({ tasks: { a: {} }, storage: { tasks: localStorageAdapter(key) } });
    owner.markDone("a");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 3, tasks: { a: "done" } });
    owner.markTodo("a");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("hands text that is not JSON on, to be reported as a record Waymark did not write", () => {
    const key = localKey("setup");
    localStorage.setItem(key, "not json");
    const onStorageError = vi.fn();
    const owner = createChecklists({
      tasks: { a: {} },
      storage: { tasks: localStorageAdapter<StoredTasks>(key) },
      onStorageError,
    });
    expect(owner.getSnapshot().storageStatus).toBe("error");
    expect(String(onStorageError.mock.calls[0]?.[0])).toMatch(/not one Waymark wrote/);
  });

  it("lets core report blocked storage, and keeps progress in memory", () => {
    const blocked = new Error("blocked");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw blocked;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw blocked;
    });
    const onStorageError = vi.fn();
    const owner = createChecklists({
      tasks: { a: {} },
      storage: { tasks: localStorageAdapter("setup") },
      onStorageError,
    });
    owner.markDone("a");
    expect(statuses(owner)).toEqual({ a: "done" });
    expect(onStorageError.mock.calls).toEqual([
      [blocked, "tasks"],
      [blocked, "tasks"],
    ]);
  });

  it("stops hearing other tabs once unsubscribed", () => {
    const listener = vi.fn();
    const stop = localStorageAdapter("other-tab").subscribe!(listener);
    const hear = (key: string | null, newValue: string | null) =>
      globalThis.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));

    hear("other-tab", '{"version":3,"tasks":{}}');
    hear(null, null);
    expect(listener.mock.calls).toEqual([[{ version: 3, tasks: {} }], [null]]);

    stop();
    hear("other-tab", "{}");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
