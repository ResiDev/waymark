// Sketch: packages/core/src/run/core.ts (~250 lines implemented)
// The core's entry points. The shell changes the model only through these:
// `commit` for a change, and the four edits for what reaches the Run between
// changes. Everything here is pure. This module is the one writer of `known`,
// `storageStatus` and `shown`; the other fields belong to schedule.ts and
// statuses.ts.

import { EMPTY } from "../checklists/record";
import { eventsBetween } from "../checklists/tasks";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, ChecklistSnapshot, StorageStatus } from "../checklists/types";
import { recordUnreadable } from "../problems";
import { changesBetween } from "../storage/records";
import type { Parsed, Read } from "../storage/records";
import type { Walkthrough } from "../walkthrough/types";
import { edit, warn } from "./model";
import type { Command, Commit, Draft, Effect, Model, RunState, World } from "./model";
import type { RunSnapshot } from "./types";
import {
  actOn,
  arrive,
  begin,
  firstLook,
  hear,
  obey,
  request,
  resetOne,
  restore,
  setAttached,
  settle,
  sightBeacons,
  unwait,
} from "./schedule";
import { NO_BEACONS, NO_PROGRESS, selectChecklist, selectRun, wanted } from "./select";
import { finish, settleConditions, startedFrom, takeStatuses, task } from "./statuses";

/** `silent`: no checklist events, as the user did nothing. `persist: false`: it came from storage, so it is not saved. */
type Flags = Readonly<{ silent: boolean; persist: boolean }>;

/**
 * Worked out from the command, so no caller can pair a command with the
 * wrong flags. No default: a new kind of command must say.
 */
const flagsOf = (command: Command): Flags => {
  switch (command.kind) {
    case "loaded":
    case "heard":
      return { silent: true, persist: false };
    case "arrive":
      return { silent: true, persist: true };
    case "start":
    case "request":
    case "act":
    case "reset":
    case "message":
    case "attach":
    case "beaconReads":
    case "task":
    case "context":
      return { silent: false, persist: true };
  }
};

/** A Run with nothing in it yet. `loading` when there is storage to read and no `initial` record. */
export function initial(storageStatus: StorageStatus): Model {
  // TODO: empty Known; record { progress: NO_PROGRESS, statuses: EMPTY }; open undefined; lastGeneration -1;
  // shown.run = { storageStatus, progress: NO_PROGRESS, open: null, beacons: NO_BEACONS }; shown.checklists empty.
  throw new Error("not implemented");
}

const draftOf = (state: RunState, world: World): Draft => ({
  state,
  world,
  events: [],
  problems: [],
  credits: new Map(),
  scrolls: [],
});

/**
 * One change, start to finish. The work, then what every change does after
 * it, then the effects in the order the shell runs them. That order is
 * load-bearing, and this is the one place it is written down.
 */
export function commit(model: Model, command: Command, world: World): Commit {
  const before = model.state.record;
  let draft = perform(draftOf(model.state, world), command);
  // A machine that collapsed or ended lets go; a waiting request opens before the beacons show.
  draft = settle(draft);
  // Tasks whose walkthrough finished are done; startedFrom forgets walkthroughs no longer running.
  draft = finish(draft, before);
  const after = draft.state.record;
  // Decided here, sent after `watch`: the open walkthrough's first look, once it is drawn.
  const { draft: done, start } = firstLook(draft);
  const { state } = done;
  // Every snapshot is worked out before any effect runs, so a callback that reads another sees this change too.
  const published = publish(model, state);
  const flags = flagsOf(command);
  // The frame loop's changes leave the record as it was, so they diff nothing.
  const changes = flags.persist && after !== before ? changesBetween(before, after) : undefined;

  const effects: Effect[] = [];
  for (const to of done.scrolls) effects.push({ kind: "scroll", to });
  // Always, not only on change: a frame that has just fired must be asked for again.
  effects.push({ kind: "watch", wanted: wanted(state, world.attached) });
  if (start !== undefined) effects.push({ kind: "look", start });
  if (published.run !== undefined) effects.push({ kind: "notify", snapshot: published.run });
  for (const [definition, snapshot] of published.changed) effects.push({ kind: "notifyChecklist", definition, snapshot });
  if (changes !== undefined) effects.push({ kind: "save", changes, record: after });
  // After notify, so a handler sees a renderer that has already redrawn.
  for (const problem of done.problems) effects.push({ kind: "report", problem });
  for (const event of done.events) effects.push({ kind: "announce", event });
  if (!flags.silent) {
    if (after !== before) {
      const tasks = [...state.known.tasks.values()];
      for (const event of eventsBetween(tasks, before, after, (id) => done.credits.get(id))) {
        effects.push({ kind: "announce", event });
      }
    }
    for (const [definition, snapshot] of published.completed) {
      effects.push({ kind: "announce", event: { type: "checklistComplete", checklist: definition.name, snapshot } });
    }
  }
  return { model: published.model, effects };
}

function perform(draft: Draft, command: Command): Draft {
  switch (command.kind) {
    case "start": {
      const begun = begin(arrive(draft, command.walkthrough), command.walkthrough);
      return command.checklist === undefined ? begun : startedFrom(begun, command.walkthrough.id, command.checklist);
    }
    case "request":
      return request(arrive(draft, command.walkthrough), command.walkthrough);
    case "act":
      return actOn(draft, command.walkthrough, command.action);
    case "reset":
      return resetOne(draft, command.walkthrough);
    case "message":
      return obey(draft, command.message);
    case "attach":
      return setAttached(draft, command.attached);
    case "beaconReads":
      return sightBeacons(draft, command.reads, command.now);
    case "task":
      return task(draft, command.command, command.id, command.checklist);
    case "arrive": {
      // "all" is read now, as the record comes in: every definition handed over while it loaded.
      const arriving = command.walkthroughs === "all" ? [...draft.state.known.walkthroughs.values()] : command.walkthroughs;
      let arrived = draft;
      for (const walkthrough of arriving) arrived = arrive(arrived, walkthrough);
      return settleConditions(arrived, command.verdicts);
    }
    case "context":
      return settleConditions(draft, command.verdicts);
    case "loaded":
      return loaded(draft, command.read);
    case "heard":
      return takeStatuses(hear(draft, command.read?.walkthroughs ?? NO_PROGRESS), command.read?.tasks ?? EMPTY);
  }
}

/** The one writer of `storageStatus`. Progress and statuses go to their owners. */
function loaded(draft: Draft, read: Parsed<Read> | "failed"): Draft {
  if (read !== "failed" && read.ok) {
    const taken = takeStatuses(restore(draft, read.value?.walkthroughs ?? NO_PROGRESS), read.value?.tasks ?? EMPTY);
    return edit(taken, { storageStatus: "ready" });
  }
  return edit(read === "failed" ? draft : warn(draft, recordUnreadable(read.error)), { storageStatus: "error" });
}

type Published = Readonly<{
  model: Model;
  /** The new Run snapshot, when it is new. */
  run: RunSnapshot | undefined;
  /** Each checklist whose snapshot is new, in the order they reached the Run. */
  changed: readonly (readonly [ChecklistDefinition<AnyTask>, ChecklistSnapshot<AnyTask>])[];
  /** Each checklist that has just become complete. */
  completed: readonly (readonly [ChecklistDefinition<AnyTask>, ChecklistSnapshot<AnyTask>])[];
}>;

/**
 * The snapshots of `state`, each the one last published when nothing in it
 * changed. What was published is the memory, so there is no cache to keep in
 * step: `openShown`, `beaconsShown` and each view's snapshot are all `shown`.
 */
function publish(model: Model, state: RunState): Published {
  // TODO:
  // run = selectRun(state, model.shown.run); runChanged = run !== model.shown.run.
  // Checklists read only record, the open walkthrough's id and storageStatus. When all three are
  // the same objects as in model.state, keep shown.checklists whole, with nothing changed: the frame
  // loop's changes, which move only the open machine's State, skip every checklist.
  // Otherwise for each [definition, previous] of shown.checklists, in order:
  //   next = selectChecklist(state, definition, previous); if next !== previous -> changed;
  //   if !previous.complete && next.complete -> completed.
  // A new shown object only when something in it is new.
  throw new Error("not implemented");
}

// Edits: what reaches the Run between changes. Each is applied at once,
// outside the queue, and changes no snapshot already published, so there is
// nothing to announce. A definition can reach the Run while it loads.

/**
 * The Run's definition for this id: the first handed over. `clash` when a
 * different one comes under an id already taken; the shell throws for it in
 * development, before anything is taken.
 */
export function take(
  model: Model,
  walkthrough: Walkthrough,
): Readonly<{ model: Model; walkthrough: Walkthrough; clash: boolean }> {
  // TODO: known = state.known.walkthroughs.get(id); undefined -> add, { walkthrough, clash: false };
  // else { model unchanged, walkthrough: known, clash: known !== walkthrough }.
  throw new Error("not implemented");
}

/**
 * A group's Tasks reach the Run, the first definition of each id, and a view
 * of each of its checklists, so each announces its completion. The shell
 * takes the group's walkthroughs first, one `take` each, so a clash throws
 * before the group counts as joined.
 */
export function join(model: Model, group: ChecklistGroup): Model {
  // TODO: if known.groups has group -> model. Else add group; add each task whose id is new, in order;
  // then addView for each of group.checklists.
  throw new Error("not implemented");
}

/** A checklist reaches the Run: its first snapshot is published, with nothing to announce. */
export function addView(model: Model, definition: ChecklistDefinition<AnyTask>): Model {
  if (model.shown.checklists.has(definition)) return model;
  const checklists = new Map(model.shown.checklists);
  checklists.set(definition, selectChecklist(model.state, definition, undefined));
  return { ...model, shown: { ...model.shown, checklists } };
}

/** A waiting request withdrawn. At once, not queued, as today: see RATIONALE, open questions. */
export function withdraw(model: Model, walkthrough: Walkthrough): Model {
  const state = unwait(model.state, walkthrough);
  return state === model.state ? model : { ...model, state };
}
