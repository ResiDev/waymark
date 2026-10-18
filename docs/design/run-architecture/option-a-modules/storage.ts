// packages/core/src/run/storage.ts — about 135 lines.
//
// Owns: the adapter, `storageStatus`, `held`.
//
// The record's way in and out. It knows the stored shape and the adapter, and
// not what any part of the record means: each part goes to the module that
// owns it through `Durable`, and a save is the difference between the two
// moments the pipeline hands it.
//
// Made first, as every command waits on it; handed the record's owners once
// they are made (`takeInitial`, `load`). It imports no owner, and reaches them
// only through `Durable`.

import type { Moment } from "../checklists/tasks";
import type { StorageStatus } from "../checklists/types";
import { recordUnreadable, storageFailed } from "../problems";
import type { ReportProblem } from "../problems";
import type { Queue } from "../queue";
import { adapterOf, loadFrom, saveTo } from "../storage/adapter";
import { changesBetween, parseRecord, storedRecord } from "../storage/records";
import type { Parsed, Read } from "../storage/records";
import type { MakeChange, RecordOwners } from "./change";
import type { RunOptions } from "./types";

export type Storage = Readonly<{
  /** `loading` until the record is in; `error` when it could not be read. */
  status: () => StorageStatus;
  /** While the record loads, a command waits, so it acts on the user's progress rather than none. Held commands run in order once it is in. */
  later: (command: () => void) => void;

  // Starting. Each once, by `createRun`, in this order.

  /** Takes `initial`, a record in hand, which a server render shows too. Nothing without one. */
  takeInitial: (owners: RecordOwners) => void;
  /** Reads the adapter's record, which a server render cannot see. Nothing with `initial`, or without an adapter. */
  load: (owners: RecordOwners) => void;

  // The pipeline's step. Only `commit` calls it.

  /** Storage gets only what changed, so a save never writes over what this Run doesn't know. `onChange` gets the whole record. */
  save: (before: Moment, after: Moment) => void;
}>;

export function createStorage({
  options,
  report,
  queue,
  make,
}: Readonly<{
  options: Pick<RunOptions, "storage" | "initial" | "onChange">;
  report: ReportProblem;
  queue: Queue;
  make: MakeChange;
}>): Storage {
  const adapter = options.storage === undefined ? undefined : adapterOf(options.storage);
  let status: StorageStatus = adapter !== undefined && options.initial === undefined ? "loading" : "ready";
  /** Commands given while the record loads, run in order once it is in. */
  const held: (() => void)[] = [];

  /**
   * A record read at start goes to its owners in a change that saves nothing,
   * as storage already holds it, and announces nothing. Then, in a change that
   * does save, what has reached the Run meets it: a stale entry dropped there
   * is saved as dropped.
   */
  const take = (owners: RecordOwners, read: Parsed<Read> | "failed"): void => {
    // TODO:
    // make((change) => {
    //   if (read !== "failed" && read.ok) {
    //     for (const owner of Object.values(owners)) owner.restore(change, read.value);
    //     status = "ready";
    //     return;
    //   }
    //   if (read !== "failed") change.problem(recordUnreadable(read.error));
    //   status = "error";
    // }, { silent: true, persist: false });
    // make((change) => { for (const owner of Object.values(owners)) owner.check(change, "loaded"); }, { silent: true });
    throw new Error("not implemented");
  };

  const loaded = (owners: RecordOwners, read: Parsed<Read> | "failed"): void => {
    // TODO: as `loaded` today:
    // try { take(owners, read); for (const command of held.splice(0)) command(); }
    // finally { adapter?.subscribe?.((value) => hear(owners, value)); }
    throw new Error("not implemented");
  };

  /** A record saved elsewhere, such as in another tab: each owner takes it as it says. */
  const hear = (owners: RecordOwners, value: unknown): void => {
    // TODO:
    // const parsed = parseRecord(value);
    // if (!parsed.ok) { report(recordUnreadable(parsed.error)); return; }
    // make((change) => { for (const owner of Object.values(owners)) owner.hear(change, parsed.value); }, { silent: true, persist: false });
    // // A Task held done by its condition stays done, though the record heard lacks it.
    // make((change) => { for (const owner of Object.values(owners)) owner.check(change, "heard"); }, { silent: true });
    throw new Error("not implemented");
  };

  return {
    status: () => status,
    later: (command) => {
      // TODO: held.push(command) while `loading`; otherwise run it now.
      throw new Error("not implemented");
    },
    takeInitial: (owners) => {
      // TODO: if (options.initial !== undefined) loaded(owners, parseRecord(options.initial));
      throw new Error("not implemented");
    },
    load: (owners) => {
      // TODO: as today, when there is an adapter and no `initial`:
      // loadFrom(adapter, (value) => loaded(owners, parseRecord(value)), (error) => {
      //   try { report(storageFailed(error)); } finally { loaded(owners, "failed"); }
      // });
      throw new Error("not implemented");
    },
    save: (before, after) => {
      // TODO:
      // const changes = changesBetween(before, after); if (changes === undefined) return;
      // if (adapter !== undefined) queue.invoke(() => saveTo(adapter, changes, (error) => report(storageFailed(error))));
      // const onChange = options.onChange;
      // if (onChange !== undefined) {
      //   const stored = storedRecord(after.progress, after.statuses);
      //   queue.callApp("onChange", () => onChange(stored));
      // }
      throw new Error("not implemented");
    },
  };
}
