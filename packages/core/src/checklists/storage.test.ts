import { afterEach, describe, expect, it, vi } from "vitest";
import { createChecklists } from "./checklists";
import { createLocalStorageRecord } from "./storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createLocalStorageRecord", () => {
  it.each(["constructor", "toString", "__proto__"])("preserves progress for task %s", (id) => {
    const record = createLocalStorageRecord("setup");
    const stored = { [id]: "skipped" } as const;
    record.save(stored);
    const loaded = record.load();
    expect(Object.hasOwn(loaded, id)).toBe(true);
    expect(loaded).toEqual(stored);
    record.save(loaded);
    expect(record.load()).toEqual(stored);
  });

  it("round-trips a record inside a versioned envelope", () => {
    const record = createLocalStorageRecord("setup");
    record.save({ a: "done", b: "skipped", c: "reopened" });
    expect(JSON.parse(localStorage.getItem("setup")!)).toEqual({
      version: 2,
      record: { a: "done", b: "skipped", c: "reopened" },
    });
    expect(record.load()).toEqual({ a: "done", b: "skipped", c: "reopened" });
  });

  it("removes the key for an empty record", () => {
    const record = createLocalStorageRecord("setup");
    record.save({ a: "done" });
    record.save({});
    expect(localStorage.getItem("setup")).toBeNull();
    expect(record.load()).toEqual({});
  });

  it("loads missing, invalid, unknown-version, or malformed data as empty", () => {
    const record = createLocalStorageRecord("setup");
    expect(record.load()).toEqual({});
    for (const text of [
      "not json",
      "null",
      '{"version":1,"record":{"done":[],"skipped":{}}}',
      '{"version":2}',
      '{"version":2,"record":["a"]}',
      '{"version":2,"record":{"a":"finished"}}',
      '{"version":2,"record":{"a":true}}',
    ]) {
      localStorage.setItem("setup", text);
      expect(record.load()).toEqual({});
    }
  });

  it("keeps an owner's progress across a reload as its storage", () => {
    const create = () =>
      createChecklists({ tasks: { hello: {}, invite: {} }, storage: createLocalStorageRecord("setup") });
    create().checklists.main.markDone("hello");
    const reloaded = create().checklists.main.getSnapshot();
    expect(reloaded.tasks.map((row) => row.status)).toEqual(["done", "todo"]);
  });

  it("swallows storage errors", () => {
    const record = createLocalStorageRecord("setup");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(record.load()).toEqual({});
    expect(() => record.save({ a: "done" })).not.toThrow();
  });
});
