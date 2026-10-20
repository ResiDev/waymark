import type { Change, RunState, Phases, UserRecord, Work } from "../state";
import type { RecordUnreadableError } from "../storage/records";
import { turnedUnreadable } from "./record";
import { conditions, finish } from "./tasks";
import { verifyAll, settle } from "./walkthroughs";

export type Ran = Readonly<{
  after: RunState;
  savedFrom: UserRecord | "whole";
  /** `undefined` when only storage and checklists arriving changed anything, so the user did nothing to announce. */
  announcedFrom: UserRecord | undefined;
  unreadable: RecordUnreadableError | undefined;
  told: Change;
}>;

const arrive: Work = (runState, change) => conditions(verifyAll(runState, change), change);

export function runChange(before: RunState, phases: Phases, now: number, verdicts: Change["verdicts"]): Ran {
  const told: Change = { now, verdicts, events: [], problems: [], credits: new Map(), scrolls: [] };
  const run = (runState: RunState, work: Work) => finish(runState, work(runState, told));

  const stored = phases.storage === undefined ? before : run(before, phases.storage);
  const arrived = phases.arrival === undefined ? stored : run(stored, arrive);
  let after = arrived;
  for (const work of phases.commands ?? []) after = run(after, work);
  after = settle(after, told);

  const silent = (phases.commands ?? []).length === 0 && (phases.storage !== undefined || phases.arrival !== undefined);
  return {
    after,
    savedFrom: phases.replace === true ? "whole" : stored.userRecord,
    announcedFrom: silent ? undefined : arrived.userRecord,
    unreadable: turnedUnreadable(before.userRecord.storageStatus, after.userRecord.storageStatus),
    told,
  };
}
