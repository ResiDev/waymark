import { describe, expect, it } from "vitest";
import { applyChanges, isRecordUnreadable, RecordUnreadableError } from "./records";
import type { StoredChanges } from "./records";

const changes = (tasks: StoredChanges["tasks"], replace?: true): StoredChanges => ({
  version: 1,
  walkthroughs: {},
  tasks,
  ...(replace === undefined ? {} : { replace }),
});

describe("applyChanges", () => {
  it("throws a RecordUnreadableError, holding the record, rather than save over one it cannot read", () => {
    const newer = { version: 2, tasks: { a: "done" } };
    let thrown: unknown;
    try {
      applyChanges(newer, changes({ b: "done" }));
    } catch (error) {
      thrown = error;
    }
    expect(isRecordUnreadable(thrown)).toBe(true);
    expect((thrown as RecordUnreadableError).stored).toBe(newer);
  });

  it("writes the changes in place of any record when they replace it", () => {
    expect(applyChanges({ version: 2 }, changes({ b: "done", c: null }, true))).toEqual({
      version: 1,
      walkthroughs: {},
      tasks: { b: "done" },
    });
  });

  it("leaves out the entries it cannot read, and keeps the rest", () => {
    const stored = { version: 1, walkthroughs: { tour: { step: 9 } }, tasks: { a: "finished", b: "done" } };
    expect(applyChanges(stored, changes({ c: "skipped" }))).toEqual({
      version: 1,
      walkthroughs: {},
      tasks: { b: "done", c: "skipped" },
    });
  });

  it("knows the error by its name, as one from another copy of Waymark would be", () => {
    expect(isRecordUnreadable(Object.assign(new Error("newer"), { name: "RecordUnreadableError" }))).toBe(true);
    expect(isRecordUnreadable(new Error("offline"))).toBe(false);
    expect(new RecordUnreadableError("newer").name).toBe("RecordUnreadableError");
  });
});
