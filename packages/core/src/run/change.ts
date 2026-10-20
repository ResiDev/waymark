import type { Change, Facts, Phases, Recorded, Work } from "../state";
import type { RecordUnreadableError } from "../storage/records";
import { turnedUnreadable } from "./record";
import { conditions, finish } from "./tasks";
import { checkAll, settle } from "./walkthroughs";

export type Ran = Readonly<{
  after: Facts;
  /** What the save is worked out against, or the whole record. */
  savedFrom: Recorded | "whole";
  /** What checklist events are worked out against; `undefined` when the change was only what storage said and checklists arriving. */
  announcedFrom: Recorded | undefined;
  /** Storage turned unreadable in this change, so the record is reported, once. */
  unreadable: RecordUnreadableError | undefined;
  told: Change;
}>;

const arrive: Work = (facts, change) => conditions(checkAll(facts, change), change);

/**
 * The parts of one change in order, Tasks finished after each, then
 * `settle` once. `now` is `Date.now()`, taken once, so every entry the
 * change writes is changed at the same time.
 */
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
    savedFrom: phases.whole === true ? "whole" : stored.recorded,
    announcedFrom: silent ? undefined : arrived.recorded,
    unreadable: turnedUnreadable(before.recorded.storage, after.recorded.storage),
    told,
  };
}
