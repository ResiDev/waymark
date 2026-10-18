// Sketch for packages/core/src/run/change.ts. Not compiled.
//
// A change to the Run: the only way the Model is written, and every kind of
// change there is. `run.ts` opens a change, hands it to one of these, then
// announces it. `page.ts` never imports this file, so the page can only read
// the Model and send messages (a boundary `fallow` can check).

import { EMPTY } from "../checklists/record";
import type { Stored } from "../checklists/record";
import type { Statuses } from "../checklists/statuses";
import { checkConditions, finishTasks, reopen } from "../checklists/tasks";
import type { Moment } from "../checklists/tasks";
import type { ChecklistGroup, DefinedTask, StorageStatus } from "../checklists/types";
import { inDevelopment } from "../dev";
import { recordDropped, recordUnreadable } from "../problems";
import type { WaymarkProblem } from "../problems";
import { DEFAULT_MAX_AGE, staleness } from "../storage/records";
import type { Parsed, Read } from "../storage/records";
import type { Walkthrough, WalkthroughProgress } from "../walkthrough/types";
import { apply, sight } from "./rules";
import type { Message, WaymarkRead } from "./rules";
import { opening, stepAt } from "./state";
import type { State } from "./state";
import type { Action, RunEvent } from "./types";
import { candidates, canonical, entryOf, epochOf, heardEntry, isPending, machineOf, momentOf, NO_SIGHTINGS, openId, shows } from "./model";
import type { Machine, Model, Sightings } from "./model";

/** The Model as a change writes it. Held inside `createModel`; nothing outside this file gets it. */
type Draft = {
  definitions: Map<string, Walkthrough>;
  progress: Readonly<Record<string, WalkthroughProgress>>;
  statuses: Stored;
  storageStatus: StorageStatus;
  waiting: Walkthrough[];
  last: Machine | undefined;
  sightings: Sightings;
  startedFrom: Map<string, string>;
  tasks: Map<string, DefinedTask>;
};

/**
 * One change being made. What it gathers is its own, not the Run's, and is
 * announced once it is done, in the order `run.ts` sets.
 */
export type Change = {
  readonly draft: Draft;
  /** The record as the change began: checklist events and finished Tasks are worked out against it. */
  readonly before: Moment;
  /** The record as storage holds it, as far as the Run knows. What is saved is what differs from it: see `inStorage`. */
  savedFrom: Moment;
  /** Writes the draft's statuses, for `checklists/tasks.ts`. */
  readonly statuses: Statuses;
  readonly events: RunEvent[];
  readonly problems: WaymarkProblem[];
  /** The checklist each Task's status was changed from, for its event. */
  readonly credits: Map<string, string>;
  /** Whether a renderer draws the Run, for a machine picked up in this change. */
  readonly attached: boolean;
  /** What completion conditions read, as the app last set it. */
  readonly context: unknown;
  /** Reports what a completion condition threw, as `callbackThrew`. */
  readonly failed: (error: unknown) => void;
  /** The first renderer has just attached, so the open walkthrough is looked at again. */
  attaching: boolean;
  /** Where the open walkthrough's step asked to be scrolled to; `page.ts` scrolls once the work is done. */
  scrollTo: Element | undefined;
};

/** The Run's Model, and the one way to write it. */
export function createModel(
  storageStatus: StorageStatus,
  failed: (error: unknown) => void,
): Readonly<{
  model: Model;
  open: (now: Readonly<{ attached: boolean; context: unknown }>) => Change;
}> {
  // TODO
  // const draft: Draft = { definitions: new Map(), progress: NO_PROGRESS, statuses: EMPTY, storageStatus,
  //   waiting: [], last: undefined, sightings: NO_SIGHTINGS, startedFrom: new Map(), tasks: new Map() };
  // open: before = savedFrom = momentOf(draft); statuses = a Statuses whose `set` and `replace`
  //   write draft.statuses (a new object only on a real change, as `createStatuses` does);
  //   events, problems, credits empty; attaching false; scrollTo undefined.
  throw new Error("not implemented");
}

/** Says storage already holds the record as it is now, so this change saves only what it changes after. */
export function inStorage(change: Change): void {
  change.savedFrom = momentOf(change.draft);
}

// The record

/**
 * Writes one walkthrough's entry, or removes it. Every write to progress but
 * the machine's own comes here, and in development it refuses the two that
 * would break the Run's one rule: writing the open walkthrough's entry
 * (only `keep` may), and opening a second walkthrough.
 */
function put(change: Change, id: string, entry: WalkthroughProgress | undefined): void {
  // TODO
  // if (inDevelopment()) {
  //   if (openId(draft) === id) throw: "only the machine writes the open walkthrough's progress"
  //   if (entry shows && definitions.has(id) && openId(draft) !== undefined) throw: "a second walkthrough opened"
  // }
  // if (draft.progress[id] === entry) return;
  // draft.progress = a copy (dictionary()) with id set or deleted
  throw new Error("not implemented");
}

/** The machine's step written back: its State, and the progress the State shows. The only writer of the open entry. */
function keep(change: Change, machine: Machine, state: State): void {
  // TODO
  // const { id } = machine.walkthrough;
  // const progress = entryOf(state.snapshot, draft.progress[id], Date.now());
  // if (progress !== draft.progress[id]) draft.progress = copy with id → progress   (not through `put`)
  // draft.last = { walkthrough: machine.walkthrough, progress, state };
  throw new Error("not implemented");
}

/**
 * Hands the Run a definition, and returns the one it keeps for the id. The
 * one place restored progress meets its definition, so at the end of every
 * change progress is unchecked exactly when its definition has not arrived.
 * Checked, progress that cannot be picked up again is dropped; one that was
 * open is left open if nothing else is, and otherwise set aside as its
 * `dismiss` says, as if interrupted.
 */
export function meet(change: Change, walkthrough: Walkthrough): Walkthrough {
  // TODO
  // const kept = canonical(draft, walkthrough); if (draft.definitions.has(kept.id)) return kept;
  // Checked before it is added, so its own entry does not count as the open one:
  // const saved = draft.progress[id]; const other = openId(draft);
  // if (saved) {
  //   const reason = staleness(saved, steps.length, maxAge ?? DEFAULT_MAX_AGE);
  //   // Dropped before the handler hears, so a walkthrough it starts keeps its progress.
  //   if (reason) { put(change, id, undefined); problems.push(recordDropped(id, reason)); }
  //   else if (shows(saved) && other !== undefined)
  //     put(change, id, dismiss === "exit" ? { ...saved, status: "exited", changedAt } : { ...saved, collapsed: true, changedAt });
  // }
  // draft.definitions.set(id, kept);
  // A restored walkthrough left open has no machine yet: `pickUp` makes it at the end of the change.
  throw new Error("not implemented");
}

/** A checklist's Tasks and their walkthroughs reach the Run, and its conditions are checked. */
export function meetGroup(change: Change, group: ChecklistGroup): void {
  // TODO
  // for task of group.tasks: if (!draft.tasks.has(task.id)) draft.tasks.set(task.id, task)
  // for task of group.tasks with a walkthrough: meet(change, task.walkthrough)
  // conditions(change)
  throw new Error("not implemented");
}

/**
 * The record loaded: taken whole, or nothing and an error status. Storage
 * holds it already, so only what is checked afterwards is saved, such as
 * progress dropped as its walkthrough's definition meets it.
 */
export function load(
  change: Change,
  read: Parsed<Read> | "failed",
  groups: Iterable<ChecklistGroup>,
): void {
  // TODO
  // ok → draft.progress = read.value?.walkthroughs ?? NO_PROGRESS; statuses.replace(read.value?.tasks ?? EMPTY);
  //      storageStatus = "ready"
  // otherwise → parse error: problems.push(recordUnreadable(error)); storageStatus = "error"
  // inStorage(change)
  // for group of groups: meetGroup(change, group)   // checklists used while it loaded, and every condition
  throw new Error("not implemented");
}

/**
 * A record saved elsewhere, such as in another tab: statuses take it whole,
 * and each walkthrough as `heardEntry` says. An entry taken for a walkthrough
 * already here is checked as a loaded one is, but what that drops is not
 * saved, so this Run never removes what another wrote.
 */
export function hear(change: Change, read: Read | null): void {
  // TODO
  // statuses.replace(read?.tasks ?? EMPTY)
  // for id of union(progress, heard): entry = heardEntry(draft, id, heard[id]);
  //   if (entry !== draft.progress[id]) put(change, id, entry)       // never the open one: heardEntry keeps it
  //   if (entry && definitions.has(id) && staleness(entry, ...)) { put(change, id, undefined); problems.push(recordDropped) }
  // inStorage(change)
  // A Task held done by its condition stays done, though the record heard lacks it:
  // conditions(change)
  throw new Error("not implemented");
}

// The open walkthrough

/**
 * The open walkthrough's machine, made if it has none: picked up where its
 * progress says, its steps after the last generation shown. Only a
 * walkthrough started afresh opens otherwise, through `startFresh`, so one
 * picked up here sends no `start` when drawn.
 */
function pickUp(change: Change): Machine | undefined {
  // TODO
  // const known = machineOf(draft); if (known) return known;
  // const id = openId(draft); if (id === undefined) return undefined;
  // const walkthrough = definitions.get(id); const progress = draft.progress[id];
  // const state = opening(walkthrough, progress.step, { stepGeneration: epochOf(draft), attached: change.attached, resumed: true });
  // return (draft.last = { walkthrough, progress, state });
  throw new Error("not implemented");
}

/** Opens a walkthrough at step 1, as one the user has not started, which sends `start` when first drawn. */
function startFresh(change: Change, walkthrough: Walkthrough): void {
  // TODO
  // const progress = { status: "running", step: 0, stepCount: steps.length, collapsed: false, changedAt: Date.now() };
  // put(change, id, progress);     // the caller has set aside any open one
  // draft.last = { walkthrough, progress, state: opening(walkthrough, 0, { stepGeneration: epochOf(draft), attached, resumed: false }) };
  throw new Error("not implemented");
}

/** A message for the open walkthrough. Nothing happens while none is open. */
export function obey(change: Change, message: Message): void {
  // TODO, as today's `obey`, with `keep` in place of `machine.state = …` and no `record`:
  // const machine = pickUp(change); if (!machine) return;
  // const from = machine.state.snapshot;
  // const outcome = apply(machine.state, message, machine.walkthrough);
  // if (outcome.scrollTo) change.scrollTo = outcome.scrollTo;
  // keep(change, machine, outcome.state);
  // if (from.phase !== "running") return;
  // waymarkGone → problems; outcome.events → events, each with the step it happened on
  throw new Error("not implemented");
}

/** Sets the open walkthrough aside as its `dismiss` says, for the one started over it. */
function interrupt(change: Change, by: string): void {
  // TODO
  // const machine = pickUp(change); running only;
  // const state = apply(machine.state, { kind: "act", action: dismiss ?? "collapse" }, walkthrough).state;
  // keep(change, machine, state);
  // events.push({ type: "interrupt", …, snapshot: state.snapshot, interruptedBy: by });
  // No `release`: its entry no longer shows, so it is no longer the machine.
  throw new Error("not implemented");
}

/**
 * Shows a walkthrough the user asked for, now: part way through, where it
 * was, with `resume`; otherwise from step 1. An open one is set aside.
 */
export function begin(change: Change, given: Walkthrough): void {
  // TODO
  // const walkthrough = meet(change, given);
  // draft.waiting = waiting without walkthrough.id
  // if (openId(draft) === walkthrough.id) return;
  // interrupt(change, walkthrough.id);
  // const saved = draft.progress[walkthrough.id];
  // if (saved?.status !== "running") return startFresh(change, walkthrough);
  // Not open and running is collapsed, as `meet` leaves at most one entry showing:
  // put(change, id, { ...saved, collapsed: false, changedAt: Date.now() });
  // const machine = pickUp(change)!;
  // events.push({ type: "resume", walkthrough: id, step, stepIndex: saved.step, snapshot: machine.state.snapshot });
  // (Today's "restore" branch, an entry showing with no machine, cannot happen: dropped.)
  throw new Error("not implemented");
}

/** Shows a walkthrough the app chose once nothing is open; nothing if the user has started it before. */
export function request(change: Change, given: Walkthrough): void {
  // TODO
  // const walkthrough = meet(change, given);
  // if (draft.progress[id] !== undefined || waiting has id) return;
  // if (openId(draft) === undefined) startFresh(change, walkthrough); else draft.waiting.push(walkthrough);
  throw new Error("not implemented");
}

/** A request withdrawn while it waits. */
export function withdraw(change: Change, id: string): void {
  // TODO: draft.waiting = waiting without id
  throw new Error("not implemented");
}

/** Only `resume`, `reset` and `exit` reach a walkthrough that is not open. */
export function actOn(change: Change, given: Walkthrough, action: Action): void {
  // TODO, as today, with `meet` for `arrive` and `put(entryOf(ended, saved))` for `record`:
  // reset → resetOne(change, given), before anything meets it;
  // const walkthrough = meet(change, given);
  // open → obey(act); resume → begin; exit of a running one → exited entry + `exit` event
  throw new Error("not implemented");
}

/** An open walkthrough goes back to step 1; any other is forgotten. */
export function resetOne(change: Change, given: Walkthrough): void {
  // TODO
  // Progress never checked is forgotten unchecked, as today: there is nothing to check it for.
  // if (isPending(draft, given.id)) put(change, given.id, undefined);
  // const walkthrough = meet(change, given);
  // if (openId(draft) === walkthrough.id) return obey(change, { kind: "act", action: "reset" });
  // put(change, walkthrough.id, undefined);
  throw new Error("not implemented");
}

/**
 * What every change ends with, before anything is announced: a waiting
 * request opens if nothing is, before the beacons show; the open
 * walkthrough has its machine; Tasks finish; credits for walkthroughs no
 * longer running go.
 */
export function settle(change: Change): void {
  // TODO
  // if (openId(draft) === undefined) {
  //   // A request the user has since started, finished or exited is dropped on the way.
  //   const next = waiting.find((w) => draft.progress[w.id] === undefined);
  //   draft.waiting = waiting after next (all of it when none);
  //   if (next) startFresh(change, next);
  // }
  // pickUp(change);
  // finishTasks(draft.tasks.values(), change.before, momentOf(draft), change.statuses);
  // for id of startedFrom: if (draft.progress[id]?.status !== "running") startedFrom.delete(id);
  // (No `release`, and no rebuilding of sightings: both are worked out in model.ts.)
  throw new Error("not implemented");
}

// The page's reports

/** The first renderer attaches, or the last detaches. Nobody looks while detached, so that time does not count towards missing or lost. */
export function setAttached(change: Change, attached: boolean): void {
  // TODO
  // obey(change, { kind: attached ? "attached" : "detached" });
  // if (attached) { change.attaching = true; return; }
  // draft.sightings = { epoch: epochOf(draft), byId: each of candidates(draft) → { ...sighting, unseenSince: undefined } };
  throw new Error("not implemented");
}

/** What each beacon's Waymark was seen as on one frame. */
export function seeBeacons(change: Change, reads: ReadonlyMap<string, WaymarkRead>, now: number): void {
  // TODO
  // draft.sightings = {
  //   epoch: epochOf(draft),
  //   byId: for each { walkthrough, progress, sighting } of candidates(draft):
  //     reads.get(id) ? sight(sighting, read, now, stepAt(walkthrough, progress.step)) : sighting,
  // };
  // Written whole, so a walkthrough no longer a candidate drops out.
  throw new Error("not implemented");
}

// Tasks

/** Every condition is checked before anything is recorded, so a throwing check changes nothing. */
export function conditions(change: Change): void {
  // TODO: if (change.context !== undefined) checkConditions(draft.tasks.values(), change.statuses, change.context, change.failed);
  throw new Error("not implemented");
}

/** A checklist row's Start: the Task's walkthrough as `begin` shows it, credited to the checklist. */
export function startTask(change: Change, id: string, checklist: string): void {
  // TODO
  // const walkthrough = draft.tasks.get(id)?.walkthrough; if (!walkthrough) return;
  // begin(change, walkthrough); draft.startedFrom.set(walkthrough.id, checklist);
  throw new Error("not implemented");
}

export function markDone(change: Change, id: string): void {
  // TODO: if (draft.tasks.has(id)) change.statuses.set(id, "done");
  throw new Error("not implemented");
}

export function markTodo(change: Change, id: string, from: string): void {
  // TODO: task → reopen(task, change.statuses); credit(id, from)
  throw new Error("not implemented");
}

export function toggle(change: Change, id: string, from: string): void {
  // TODO: todo → done; else reopen; credit(id, from)
  throw new Error("not implemented");
}

/**
 * Skips a todo Task and exits its walkthrough. From its popover, `from` is
 * missing, and the credit goes to the checklist whose Start began it.
 */
export function skip(change: Change, id: string, from: string | undefined): void {
  // TODO
  // const task = draft.tasks.get(id); if (!task || status !== "todo") return;
  // change.statuses.set(id, "skipped");
  // const walkthrough = task.walkthrough && meet(change, task.walkthrough);
  // credit(id, from ?? (walkthrough && draft.startedFrom.get(walkthrough.id)));
  // if (walkthrough) actOn(change, walkthrough, "exit");
  throw new Error("not implemented");
}
