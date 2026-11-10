import { describe, expect, it } from "vitest";
import { applyChanges, combine, isRecordUnreadable, parseRecord, RecordUnreadableError } from "./records";
import type { WalkthroughProgress } from "../walkthrough/types";
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

  it("keeps a walkthrough's stored entry when it changed later than the save's, so an older save landing last does not undo it", () => {
    const finished = { ...progress, status: "finished", step: 2, changedAt: 2_000 } as const;
    const record = (tour: WalkthroughProgress) => ({ version: 1, walkthroughs: { tour }, tasks: {} });
    const saving = (tour: WalkthroughProgress, replace?: true): RecordChanges => ({
      ...changes({}, [], replace),
      set: { walkthroughs: { tour }, tasks: {} },
    });
    expect(applyChanges(record(finished), saving(progress))).toEqual(record(finished));
    expect(applyChanges(record(progress), saving(finished))).toEqual(record(finished));
    // At the same time the save wins, so a tab that starts and finishes within a millisecond keeps the finish.
    const sameTime = { ...progress, changedAt: 2_000 };
    expect(applyChanges(record(finished), saving(sameTime))).toEqual(record(sameTime));
    // A removal has no time, so it goes through, and a replace stores its record whole.
    expect(applyChanges(record(finished), { ...changes({}), remove: { walkthroughs: ["tour"], tasks: [] } })).toBeNull();
    expect(applyChanges(record(finished), saving(progress, true))).toEqual(record(progress));
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

// Thread 3: a reset is kept with its time, so whichever is newer, a walkthrough's entry or its reset, wins.
describe("resets", () => {
  const at = (changedAt: number): WalkthroughProgress => ({ ...progress, changedAt });
  const resetting = (resets: Record<string, number>): RecordChanges => ({
    version: 1,
    set: { walkthroughs: {}, resets, tasks: {} },
    remove: { walkthroughs: Object.keys(resets), tasks: [] },
  });
  const setting = (walkthroughs: Record<string, WalkthroughProgress>): RecordChanges => ({
    version: 1,
    set: { walkthroughs, tasks: {} },
    remove: { walkthroughs: [], tasks: [] },
  });
  const record = (walkthroughs: Record<string, WalkthroughProgress>, resets?: Record<string, number>) => ({
    version: 1,
    walkthroughs,
    ...(resets === undefined ? {} : { resets }),
    tasks: { t: "done" },
  });

  it("reads a record written before resets, and leaves the field out of one with none", () => {
    expect(parseRecord(record({ tour: at(1_000) }))).toMatchObject({ ok: true, value: { resets: {} } });
    expect(applyChanges(record({ tour: at(1_000) }), changes({ u: "done" }))).not.toHaveProperty("resets");
  });

  it("stores a reset in place of an older entry, and keeps a newer entry over a reset", () => {
    expect(applyChanges(record({ tour: at(1_000) }), resetting({ tour: 2_000 }))).toEqual(record({}, { tour: 2_000 }));
    expect(applyChanges(record({ tour: at(3_000) }), resetting({ tour: 2_000 }))).toEqual(record({ tour: at(3_000) }));
  });

  it("keeps a reset over an older save landing after it, and gives way to a newer one", () => {
    expect(applyChanges(record({}, { tour: 2_000 }), setting({ tour: at(1_000) }))).toEqual(record({}, { tour: 2_000 }));
    expect(applyChanges(record({}, { tour: 2_000 }), setting({ tour: at(3_000) }))).toEqual(record({ tour: at(3_000) }));
  });

  it("lets an entry win a reset at the same time, whichever lands first", () => {
    expect(applyChanges(record({}, { tour: 2_000 }), setting({ tour: at(2_000) }))).toEqual(record({ tour: at(2_000) }));
    expect(applyChanges(record({ tour: at(2_000) }), resetting({ tour: 2_000 }))).toEqual(record({ tour: at(2_000) }));
  });

  it("drops a stored reset no newer than its walkthrough's entry", () => {
    expect(parseRecord(record({ tour: at(3_000) }, { tour: 2_000 }))).toMatchObject({ ok: true, value: { walkthroughs: { tour: at(3_000) }, resets: {} } });
    expect(parseRecord(record({ tour: at(2_000) }, { tour: 2_000 }))).toMatchObject({ ok: true, value: { walkthroughs: { tour: at(2_000) }, resets: {} } });
  });

  it("combines a reset and a later start into the start", () => {
    expect(combine(resetting({ tour: 2_000 }), setting({ tour: at(3_000) }))).toEqual(setting({ tour: at(3_000) }));
  });
});
