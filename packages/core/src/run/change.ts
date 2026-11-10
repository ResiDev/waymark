import type { Change, RunState, Phases, UserRecord, Work } from "../state";
import { dictionary } from "../dictionary";
import type { RecordUnreadableError } from "../storage/records";
import type { WalkthroughProgress } from "../walkthrough/types";
import { turnedUnreadable } from "./record";
import { conditions, finish, tickFinished } from "./tasks";
import { verifyAll, settle } from "./walkthroughs";

export type Ran = Readonly<{
  after: RunState;
  savedFrom: UserRecord | "whole";
  /** `undefined` when only storage and checklists arriving changed anything, so the user did nothing to announce. */
  announcedFrom: UserRecord | undefined;
  unreadable: RecordUnreadableError | undefined;
  told: Change;
}>;

/** What storage holds: the record heard, with the entries storage holds older than the ones this tab kept. */
const asStored = (userRecord: UserRecord, storedOlder: Change["storedOlder"]): UserRecord =>
  storedOlder.size === 0
    ? userRecord
    : { ...userRecord, walkthroughProgressById: Object.assign(dictionary<WalkthroughProgress>(), userRecord.walkthroughProgressById, Object.fromEntries(storedOlder)) };

const arrive: Work = (runState, change) => conditions(verifyAll(runState, change), change);

export function runChange(before: RunState, phases: Phases, now: number, verdicts: Change["verdicts"]): Ran {
  const told: Change = { now, verdicts, events: [], problems: [], credits: new Map(), scrolls: [], storedOlder: new Map() };
  const run = (runState: RunState, work: Work) => finish(runState, work(runState, told));

  const heard = phases.storage === undefined ? before : phases.storage(before, told);
  // What another tab or an earlier visit finished, ticked silently, and saved since `heard` is the baseline.
  const stored = phases.storage === undefined ? before : tickFinished(finish(before, heard), told);
  const arrived = phases.arrival === undefined ? stored : run(stored, arrive);
  let after = arrived;
  for (const work of phases.commands ?? []) after = run(after, work);
  after = settle(after, told);

  const silent = (phases.commands ?? []).length === 0 && (phases.storage !== undefined || phases.arrival !== undefined);
  return {
    after,
    savedFrom: phases.replace === true ? "whole" : asStored(heard.userRecord, told.storedOlder),
    announcedFrom: silent ? undefined : arrived.userRecord,
    unreadable: turnedUnreadable(before.userRecord.storageStatus, after.userRecord.storageStatus),
    told,
  };
}
