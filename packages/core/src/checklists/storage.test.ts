import { afterEach, describe, expect, it, vi } from "vitest";
import { createChecklists } from "./checklists";
import { createLocalStorageRecord } from "./storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createLocalStorageRecord", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "preserves skipped progress for checklist %s",
    (name) => {
      const record = createLocalStorageRecord("setup");
      const stored = { done: [], skipped: { [name]: ["a"] } };
      record.save(stored);
      const loaded = record.load();
      expect(Object.hasOwn(loaded.skipped, name)).toBe(true);
      expect(loaded).toEqual(stored);
      record.save(loaded);
      expect(record.load()).toEqual(stored);
    },
  );

  it("round-trips a record inside a versioned envelope", () => {
    const record = createLocalStorageRecord("setup");
    record.save({ done: ["a"], skipped: { home: ["b"] } });
    expect(JSON.parse(localStorage.getItem("setup")!)).toEqual({
      version: 1,
      record: { done: ["a"], skipped: { home: ["b"] } },
    });
    expect(record.load()).toEqual({ done: ["a"], skipped: { home: ["b"] } });
  });

  it("removes the key for an empty record", () => {
    const record = createLocalStorageRecord("setup");
    record.save({ done: ["a"], skipped: {} });
    record.save({ done: [], skipped: {} });
    expect(localStorage.getItem("setup")).toBeNull();
    expect(record.load()).toEqual({ done: [], skipped: {} });
  });

  it("removes the key when every skipped list is empty", () => {
    const record = createLocalStorageRecord("setup");
    record.save({ done: ["a"], skipped: {} });
    record.save({ done: [], skipped: { home: [], retired: [] } });
    expect(localStorage.getItem("setup")).toBeNull();
  });

  it("keeps progress when only some skipped lists are empty", () => {
    const record = createLocalStorageRecord("setup");
    const stored = { done: [], skipped: { home: [], retired: ["unknown-task"] } };
    record.save(stored);
    expect(record.load()).toEqual(stored);
  });

  it("loads missing, invalid, unknown-version, or malformed data as empty", () => {
    const record = createLocalStorageRecord("setup");
    const empty = { done: [], skipped: {} };
    expect(record.load()).toEqual(empty);
    for (const text of [
      "not json",
      "null",
      '{"version":2,"record":{"done":[],"skipped":{}}}',
      '{"version":1}',
      '{"version":1,"record":{"done":"a","skipped":{}}}',
      '{"version":1,"record":{"done":[],"skipped":{"home":"b"}}}',
      '{"version":1,"record":{"done":[1],"skipped":{}}}',
      '{"version":1,"record":{"done":[],"skipped":{},"reopened":"a"}}',
    ]) {
      localStorage.setItem("setup", text);
      expect(record.load()).toEqual(empty);
    }
  });

  it("keeps an owner's progress across a reload as its storage", () => {
    const create = () =>
      createChecklists({ tasks: { hello: {}, invite: {} }, storage: createLocalStorageRecord("setup") });
    create().checklists.main.markDone("hello");
    const reloaded = create().checklists.main.getSnapshot();
    expect(reloaded.tasks.map((row) => row.status)).toEqual(["done", "todo"]);
  });

  it("keeps reopened tasks, and writes none when there are none", () => {
    const record = createLocalStorageRecord("setup");
    record.save({ done: [], skipped: {}, reopened: ["photo"] });
    expect(record.load()).toEqual({ done: [], skipped: {}, reopened: ["photo"] });
    record.save({ done: [], skipped: {}, reopened: [] });
    expect(localStorage.getItem("setup")).toBeNull();
  });

  it("swallows storage errors", () => {
    const record = createLocalStorageRecord("setup");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(record.load()).toEqual({ done: [], skipped: {} });
    expect(() => record.save({ done: ["a"], skipped: {} })).not.toThrow();
  });
});
