import type { Change, Command, Effect, Given, Inputs, Model, Msg, Phases, RunState, Updated, UserRecord, Views, Work } from "../state";
import { changesBetween, replacing, storedRecord } from "../storage/records";
import type { RecordChanges } from "../storage/records";
import { runChange } from "./change";
import type { Ran } from "./change";
import { heard, loaded, refused, replaced } from "./record";
import { conditions, eventsBetween, isComplete, markDone, markTodo, skip, startFrom, tasksOf, toggle } from "./tasks";
import { checklistNow, viewAll, viewRun } from "./views";
import { act, detached, obey, openId, request, reset, seeBeaconWaymarks, start, unwait, wait } from "./walkthroughs";

const NO_EFFECTS: readonly Effect[] = Object.freeze([]);
const SYNC_PAGE: Effect = { _tag: "syncPage" };

export const runStateOf = (model: Model, given: Given): RunState => ({
  walkthroughsAndChecklistsInUse: given.walkthroughsAndChecklistsInUse,
  checklistContext: given.checklistContext,
  userRecord: model.userRecord,
  startRequests: model.startRequests,
  live: model.live,
});

/** The Run's first model, before any change: nothing open, nothing waiting, the record at `userRecord`. */
export function initialModel(given: Given, userRecord: UserRecord): Model {
  const facts = { userRecord, startRequests: { waitingToStart: [], startedFromChecklist: new Map() }, live: { openStep: undefined, beaconWaymarks: new Map() } };
  return { ...facts, held: [], views: { run: viewRun(undefined, { walkthroughsAndChecklistsInUse: given.walkthroughsAndChecklistsInUse, ...facts }), checklists: new Map() } };
}

const loading = (model: Model) => model.userRecord.storageStatus.type === "loading";

const unchanged = (model: Model): Updated => ({ model, effects: NO_EFFECTS });

const toRecord =
  (write: (userRecord: UserRecord, told: Change, runState: RunState) => UserRecord): Work =>
  (runState, told) => {
    const userRecord = write(runState.userRecord, told, runState);
    return userRecord === runState.userRecord ? runState : { ...runState, userRecord };
  };

const workOf = (command: Command): Work => {
  switch (command._tag) {
    case "start":
      return command.fromChecklist === undefined ? start(command.walkthrough) : startFrom(command.walkthrough, command.fromChecklist);
    case "request":
      return request(command.walkthrough);
    case "act":
      return act(command.action, command.walkthrough);
    case "reset":
      return reset(command.walkthrough);
    case "markDone":
      return markDone(command.task);
    case "markTodo":
      return markTodo(command.task, command.checklist);
    case "toggle":
      return toggle(command.task, command.checklist);
    case "skip":
      return skip(command.task, command.checklist);
  }
};

function saved({ savedFrom, after }: Ran): RecordChanges | undefined {
  const now = after.userRecord;
  if (savedFrom === "whole") return replacing(storedRecord(now.walkthroughProgressById, now.taskStatusById));
  if (savedFrom.walkthroughProgressById === now.walkthroughProgressById && savedFrom.taskStatusById === now.taskStatusById) return undefined;
  return changesBetween(
    { progress: savedFrom.walkthroughProgressById, statuses: savedFrom.taskStatusById },
    { progress: now.walkthroughProgressById, statuses: now.taskStatusById },
  );
}

/** Checklist events, then `checklistComplete` for each checklist not complete at the announce baseline and complete now. */
function checklistEvents(ran: Ran, given: Given, views: Views): readonly Effect[] {
  const { announcedFrom, after, told } = ran;
  const now = after.userRecord;
  if (
    announcedFrom === undefined ||
    (announcedFrom.taskStatusById === now.taskStatusById && announcedFrom.walkthroughProgressById === now.walkthroughProgressById)
  ) {
    return NO_EFFECTS;
  }
  const effects: Effect[] = [];
  const credit = (id: string) => told.credits.get(id);
  for (const event of eventsBetween(tasksOf(after.walkthroughsAndChecklistsInUse.checklistDefinitions), announcedFrom, now, credit)) {
    effects.push({ _tag: "event", event });
  }
  for (const definition of given.checklistsAsked.keys()) {
    if (isComplete(definition, announcedFrom.taskStatusById) || !isComplete(definition, now.taskStatusById)) continue;
    const shown = checklistNow(views, given, definition);
    if (shown !== undefined) effects.push({ _tag: "event", event: { type: "checklistComplete", checklist: definition.name, snapshot: shown.value } });
  }
  return effects;
}

/**
 * What one change does to the outside, in order: scrolls, the page,
 * listeners, the save, problems, then events. Every snapshot is worked out
 * before the first effect, so a listener that reads another snapshot sees
 * this change too.
 */
function effectsOf(ran: Ran, given: Given, was: Views, views: Views): readonly Effect[] {
  const { told, after } = ran;
  const effects: Effect[] = [];
  for (const element of told.scrolls) effects.push({ _tag: "scroll", element });
  effects.push(SYNC_PAGE);
  if (views.run.snapshot !== was.run.snapshot) effects.push({ _tag: "notifyRun", snapshot: views.run.snapshot.value });
  for (const checklist of given.checklistsAsked.keys()) {
    const shown = checklistNow(views, given, checklist);
    if (shown !== undefined && shown.value !== checklistNow(was, given, checklist)?.value) {
      effects.push({ _tag: "notifyChecklist", checklist, snapshot: shown.value });
    }
  }
  const changes = saved(ran);
  if (changes !== undefined) {
    effects.push(
      { _tag: "save", changes },
      { _tag: "saved", record: storedRecord(after.userRecord.walkthroughProgressById, after.userRecord.taskStatusById) },
    );
  }
  if (ran.unreadable !== undefined) effects.push({ _tag: "recordUnreadable", error: ran.unreadable });
  for (const problem of told.problems) effects.push({ _tag: "problem", problem });
  for (const event of told.events) effects.push({ _tag: "event", event });
  for (const effect of checklistEvents(ran, given, views)) effects.push(effect);
  return effects;
}

/** Runs the parts of one change on the model, works out every view, and says what to tell. */
function change(model: Model, given: Given, phases: Phases, inputs: Inputs): Updated {
  const ran = runChange(runStateOf(model, given), phases, inputs.now, inputs.verdicts);
  const { after } = ran;
  const views = viewAll(model.views, given, after);
  const next: Model =
    after.userRecord === model.userRecord && after.startRequests === model.startRequests && after.live === model.live && views === model.views
      ? model
      : { userRecord: after.userRecord, startRequests: after.startRequests, live: after.live, held: model.held, views };
  return { model: next, effects: effectsOf(ran, given, model.views, views) };
}

/** While the record loads, a command waits on `held`; otherwise it is a change of its own. */
const command = (model: Model, given: Given, held: Command, inputs: Inputs): Updated =>
  loading(model) ? unchanged({ ...model, held: [...model.held, held] }) : change(model, given, { commands: [workOf(held)] }, inputs);

const withStartRequests = (model: Model, startRequests: Model["startRequests"]): Model =>
  startRequests === model.startRequests ? model : { ...model, startRequests };

export function update(model: Model, given: Given, msg: Msg, inputs: Inputs): Updated {
  switch (msg._tag) {
    case "start":
    case "request":
    case "act":
    case "reset":
    case "markDone":
    case "markTodo":
    case "toggle":
    case "skip":
      return command(model, given, msg, inputs);
    // On the waiting list at once, even while loading, so a start held meanwhile finds it waiting.
    case "requestStart":
      return command(withStartRequests(model, wait(model.startRequests, msg.walkthrough.id)), given, { _tag: "request", walkthrough: msg.walkthrough }, inputs);
    case "withdrawRequest":
      return unchanged(withStartRequests(model, unwait(model.startRequests, msg.walkthrough)));
    // Not held: only the latest context matters, and the load asks the conditions once the record is in.
    case "contextChanged":
      return loading(model) ? unchanged(model) : change(model, given, { commands: [conditions] }, inputs);
    // While loading, the load checks every definition there is by then.
    case "arrived":
      return loading(model) ? unchanged(model) : change(model, given, { arrival: true }, inputs);
    case "loaded": {
      const { read } = msg;
      const commands = model.held.map((held) => workOf(held));
      return change({ ...model, held: [] }, given, { storage: toRecord((was, told) => loaded(was, read, told)), arrival: true, commands }, inputs);
    }
    case "heard": {
      const { read } = msg;
      const storage = toRecord((was, told, at) => heard(was, read, openId(at), at.walkthroughsAndChecklistsInUse.walkthroughsById, told));
      return change(model, given, { storage }, inputs);
    }
    case "refused": {
      const { error } = msg;
      return change(model, given, { storage: toRecord((was) => refused(was, error)) }, inputs);
    }
    case "replaced": {
      const { read } = msg;
      return change(model, given, { storage: toRecord((was, told) => replaced(was, read, told)), arrival: true, replace: true }, inputs);
    }
    case "page":
      return change(model, given, { commands: [obey(msg.message)] }, inputs);
    case "beaconsRead":
      return change(model, given, { commands: [seeBeaconWaymarks(msg.reads, msg.now)] }, inputs);
    case "attached":
      return change(model, given, {}, inputs);
    case "detached":
      return change(model, given, { commands: [detached] }, inputs);
  }
}
