import { describe, expect, it } from "vitest";
import { applyChanges, combine, isRecordUnreadable, parseRecord, RecordUnreadableError } from "./records";
import type { RecordChanges } from "./records";

/** A save that sets these tasks' statuses and removes these. */
const changes = (tasks: RecordChanges["set"]["tasks"], removed: readonly string[] = [], replace?: true): RecordChanges => ({
  version: 1,
  set: { walkthroughs: {}, tasks },
  remove: { walkthroughs: [], tasks: removed },
  ...(replace === undefined ? {} : { replace }),
});

const progress = { status: "running", step: 1, stepCount: 3, collapsed: false, changedAt: 1_000 } as const;

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
    expect(applyChanges({ version: 2 }, changes({ b: "done" }, [], true))).toEqual({
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

  it("sets and removes entries, keeps the rest, and gives null once nothing is left", () => {
    const stored = { version: 1, walkthroughs: { tour: progress }, tasks: { a: "done", b: "skipped" } };
    expect(applyChanges(stored, changes({ c: "done" }, ["a"]))).toEqual({
      version: 1,
      walkthroughs: { tour: progress },
      tasks: { b: "skipped", c: "done" },
    });
    expect(applyChanges({ version: 1, walkthroughs: {}, tasks: { a: "done" } }, changes({}, ["a"]))).toBeNull();
  });

  it("takes changes as a request body parsed them, and refuses what a Run did not send", () => {
    expect(applyChanges(null, JSON.parse(JSON.stringify(changes({ a: "done" }))))).toEqual({ version: 1, walkthroughs: {}, tasks: { a: "done" } });
    expect(() => applyChanges(null, { version: 1, walkthroughs: {}, tasks: { a: "done" } })).toThrow(/a whole record/);
    expect(() => applyChanges(null, { ...changes({}), version: 2 })).toThrow(/version 2, and this Waymark reads up to 1/);
    expect(() => applyChanges(null, changes({ a: "finished" as "done" }))).toThrow(/Task "a"'s status cannot be read/);
    expect(() => applyChanges(null, { ...changes({}), remove: { walkthroughs: [1], tasks: [] } })).toThrow(/not ones a Run sent/);
    expect(() => applyChanges(null, "text")).toThrow(/not ones a Run sent/);
  });

  it("knows the error by its name, as one from another copy of Waymark would be", () => {
    expect(isRecordUnreadable(Object.assign(new Error("newer"), { name: "RecordUnreadableError" }))).toBe(true);
    expect(isRecordUnreadable(new Error("offline"))).toBe(false);
    expect(new RecordUnreadableError("newer").name).toBe("RecordUnreadableError");
  });
});

describe("combine", () => {
  it("puts the later save's entries over the earlier's, and a later set undoes an earlier removal", () => {
    expect(combine(changes({ a: "done" }, ["b"]), changes({ b: "skipped" }, ["a"]))).toEqual(changes({ b: "skipped" }, ["a"]));
  });

  it("keeps a whole record whole, and lets a later whole one take its place", () => {
    expect(combine(changes({ a: "done" }, [], true), changes({ b: "done" }, ["a"]))).toEqual(changes({ b: "done" }, [], true));
    expect(combine(changes({ a: "done" }), changes({ b: "done" }, [], true))).toEqual(changes({ b: "done" }, [], true));
  });
});

describe("parseRecord", () => {
  it("refuses stored changes by name, rather than read them as a record with entries missing", () => {
    const parsed = parseRecord(JSON.parse(JSON.stringify(changes({ a: "done" }))));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.error.message).toMatch(/a save's changes, not a record/);
  });
});
