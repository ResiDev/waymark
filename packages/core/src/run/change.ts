import type { Change, Facts, Phases, Recorded, Work } from "../state";
import type { RecordUnreadableError } from "../storage/records";
import { turnedUnreadable } from "./record";
import { conditions, finish } from "./tasks";
import { checkAll, settle } from "./walkthroughs";

export type Ran = Readonly<{
  after: Facts;
  savedFrom: Recorded | "whole";
  /** `undefined` when only storage and checklists arriving changed anything, so the user did nothing to announce. */
  announcedFrom: Recorded | undefined;
  unreadable: RecordUnreadableError | undefined;
  told: Change;
}>;

const arrive: Work = (facts, change) => conditions(checkAll(facts, change), change);

export function runChange(before: Facts, phases: Phases, now: number, verdicts: Change["verdicts"]): Ran {
  const told: Change = { now, verdicts, events: [], problems: [], credits: new Map(), scrolls: [] };
  const run = (facts: Facts, work: Work) => finish(facts, work(facts, told));

  const stored = phases.storage === undefined ? before : run(before, phases.storage);
  const arrived = phases.arrival === undefined ? stored : run(stored, arrive);
  let after = arrived;
  for (const work of phases.commands ?? []) after = run(after, work);
  after = settle(after, told);

  const silent = (phases.commands ?? []).length === 0 && (phases.storage !== undefined || phases.arrival !== undefined);
  return {
    after,
    savedFrom: phases.replace === true ? "whole" : stored.recorded,
    announcedFrom: silent ? undefined : arrived.recorded,
    unreadable: turnedUnreadable(before.recorded.storage, after.recorded.storage),
    told,
  };
}
