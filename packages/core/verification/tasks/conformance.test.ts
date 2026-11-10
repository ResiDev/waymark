// Walks every state and move TLC reaches in ConformanceTasks.tla through the
// real update(), and checks the code holds the statuses, saves and announces
// what Tasks.tla says it does.
import { expect, it } from "vitest";
import { defineChecklists, groupOf } from "../../src/checklists/checklists";
import type { AnyTask, ChecklistDefinition, ChecklistGroup, Task } from "../../src/checklists/types";
import { LOADING, READY, userRecordAt } from "../../src/run/record";
import { initialModel, runStateOf, update } from "../../src/run/update";
import { checklistNow, viewChecklist } from "../../src/run/views";
import { openId } from "../../src/run/walkthroughs";
import type { Given, Model, Msg } from "../../src/state";
import { VERSION } from "../../src/storage/migrations";
import { applyChanges, parseRecord } from "../../src/storage/records";
import type { StoredRecord } from "../../src/storage/records";
import type { Walkthrough, WalkthroughProgress } from "../../src/walkthrough/types";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";
import { conform, type Conformance } from "../tla/conform";
import { dumpGraph } from "./tlc";
import { asBoolean, asList, asOneOf, asString, field, type Value } from "./values";

const TASKS = ["a", "b"] as const;
const WALKS = ["w1", "w2"] as const;
const PROGS = ["none", "running", "collapsed", "finished", "exited"] as const;
const STATUSES = ["absent", "done", "skipped", "reopened"] as const;
const LISTS = { home: ["a", "b"], side: ["a"] } as const;

type TaskId = (typeof TASKS)[number];
type WalkId = (typeof WALKS)[number];
type Prog = (typeof PROGS)[number];
type Status = (typeof STATUSES)[number];

/** A setting of MCTasks.tla's constants. */
type Setup = Readonly<{ name: string; walkOf: Readonly<Record<TaskId, WalkId>>; cond: readonly TaskId[]; spec: string; constraint?: string }>;

const APART = { a: "w1", b: "w2" } as const;
const SHARED = { a: "w1", b: "w1" } as const;

const setups: readonly Setup[] = [
  { name: "tab B alone, a on w1, b on w2 with a condition", walkOf: APART, cond: ["b"], spec: "OneTabSpec" },
  { name: "tab B alone, a and b share w1, neither with a condition", walkOf: SHARED, cond: [], spec: "OneTabSpec" },
  { name: "tab B hearing tab A, a on w1, b on w2 with a condition", walkOf: APART, cond: ["b"], spec: "TwoTabSpec", constraint: "OneWriteUnheard" },
];

// ─── The model's state ──────────────────────────────────────────────────────

type ModelState = Readonly<{
  prog: Readonly<Record<WalkId, Prog>>;
  mem: Readonly<Record<TaskId, Status>>;
  joined: boolean;
  verdict: Readonly<Record<TaskId, boolean>>;
  sprog: Readonly<Record<WalkId, Prog>>;
  stasks: Readonly<Record<TaskId, Status>>;
  said: readonly string[];
}>;

const byWalk = (value: Value) => ({ w1: asOneOf(field(value, "w1"), PROGS), w2: asOneOf(field(value, "w2"), PROGS) });
const byTask = (value: Value) => ({ a: asOneOf(field(value, "a"), STATUSES), b: asOneOf(field(value, "b"), STATUSES) });

const modelState = (get: (name: string) => Value): ModelState => ({
  prog: byWalk(get("prog")),
  mem: byTask(get("mem")),
  joined: asBoolean(get("joined")),
  verdict: { a: asBoolean(field(get("verdict"), "a")), b: asBoolean(field(get("verdict"), "b")) },
  sprog: byWalk(get("sprog")),
  stasks: byTask(get("stasks")),
  said: asList(get("said"))
    .map((event) => asList(event).map(asString).join(":")),
});

const shows = (status: Status) => (status === "done" || status === "skipped" ? status : "todo");

// ─── The real Run, driven as run.ts drives it ──────────────────────────────

type World = Readonly<{
  model: Model;
  given: Given;
  now: number;
  /** The record both tabs share. */
  storage: StoredRecord | null;
  verdict: Readonly<Record<TaskId, boolean>>;
  /** The checklist events B's last change announced, as type:id. */
  said: readonly string[];
}>;

type Harness = Readonly<{
  setup: Setup;
  walkthroughs: Readonly<Record<WalkId, Walkthrough>>;
  group: ChecklistGroup;
  lists: readonly ChecklistDefinition<AnyTask>[];
  /** Before any checklist mounts: both walkthroughs handed to the Run, as the model has it. */
  bare: Given;
}>;

function harnessFor(setup: Setup): Harness {
  const walkthroughs = { w1: defineWalkthrough({ id: "w1", steps: [{}] }), w2: defineWalkthrough({ id: "w2", steps: [{}] }) };
  const taskOf = (id: TaskId): Task => ({
    walkthrough: walkthroughs[setup.walkOf[id]],
    ...(setup.cond.includes(id) ? { isComplete: () => false } : {}),
  });
  const defined = defineChecklists({ tasks: { a: taskOf("a"), b: taskOf("b") }, checklists: LISTS });
  const lists = [defined.checklists.home, defined.checklists.side];
  const bare: Given = {
    walkthroughsAndChecklistsInUse: { walkthroughsById: new Map(WALKS.map((id) => [id, walkthroughs[id]])), checklistDefinitions: [] },
    checklistContext: {},
    checklistsAsked: new Map(),
  };
  return { setup, walkthroughs, group: groupOf(defined.checklists.home), lists, bare };
}

const TRACKED = new Set(["taskComplete", "taskReopened", "taskSkipped", "taskUnskipped", "checklistComplete"]);

/** One Msg through update(), with its saves made to the shared record. Returns the checklist events it announced. */
function send(world: World, msg: Msg): [World, string[]] {
  const { model, effects } = update(world.model, world.given, msg, {
    now: world.now,
    verdicts: (tasks) => new Map(tasks.map((task) => [task.id, world.verdict[task.id as TaskId]])),
  });
  let { storage } = world;
  const said: string[] = [];
  for (const effect of effects) {
    if (effect._tag === "save") storage = applyChanges(storage, effect.changes);
    if (effect._tag !== "event" || !TRACKED.has(effect.event.type)) continue;
    const { event } = effect;
    said.push("task" in event ? `${event.type}:${event.task.id}` : "checklist" in event ? `${event.type}:${event.checklist}` : event.type);
  }
  return [{ ...world, model, storage }, said];
}

/** A change of B's: one or more Msgs, whose checklist events are what B said. */
function change(world: World, ...msgs: Msg[]): World {
  let next = { ...world, now: world.now + 1000 };
  const said: string[] = [];
  for (const msg of msgs) {
    const [after, events] = send(next, msg);
    next = after;
    said.push(...events);
  }
  return { ...next, said };
}

/** run.ts join, then the arrived it sends. */
function join(harness: Harness, world: World): World {
  const inUse = world.given.walkthroughsAndChecklistsInUse;
  let given: Given = { ...world.given, walkthroughsAndChecklistsInUse: { ...inUse, checklistDefinitions: [harness.group] } };
  const asked = new Map(given.checklistsAsked);
  for (const definition of harness.lists) {
    asked.set(definition, { group: harness.group, first: viewChecklist(definition, harness.group, undefined, runStateOf(world.model, given)) });
  }
  given = { ...given, checklistsAsked: asked };
  return change({ ...world, given }, { _tag: "arrived" });
}

/** What tab A writes to the shared record. */
function aWrites(world: World, write: (record: { walkthroughs: Record<string, WalkthroughProgress>; tasks: Record<string, Status> }) => void): World {
  const record = { walkthroughs: { ...world.storage?.walkthroughs }, tasks: { ...world.storage?.tasks } as Record<string, Status> };
  write(record);
  const tasks = Object.fromEntries(Object.entries(record.tasks).filter(([, status]) => status !== "absent")) as StoredRecord["tasks"];
  return { ...world, now: world.now + 1000, storage: { version: VERSION, walkthroughs: record.walkthroughs, tasks }, said: [] };
}

const progressAt = (status: WalkthroughProgress["status"], now: number): WalkthroughProgress => ({ status, step: 0, stepCount: 1, collapsed: false, changedAt: now });

function act(harness: Harness, world: World, action: string): World {
  const { walkthroughs, setup } = harness;
  const name = /^(?<verb>[A-Za-z]+?)(?<arg>W1|W2|A|B)$/.exec(action)?.groups;
  const arg = name?.["arg"];
  const walkthrough = arg === "W1" || arg === "W2" ? walkthroughs[arg === "W1" ? "w1" : "w2"] : undefined;
  const task = arg === "A" ? "a" : arg === "B" ? "b" : undefined;
  const needWalk = (): Walkthrough => {
    if (walkthrough === undefined) throw new Error(`${action} names no walkthrough.`);
    return walkthrough;
  };
  const needTask = (): TaskId => {
    if (task === undefined) throw new Error(`${action} names no task.`);
    return task;
  };
  switch (name?.["verb"] ?? action) {
    case "Start":
      return change(world, { _tag: "start", walkthrough: needWalk(), fromChecklist: undefined });
    case "Resume":
      return change(world, { _tag: "act", action: "resume", walkthrough: needWalk() });
    case "Collapse":
      return change(world, { _tag: "act", action: "collapse", walkthrough: needWalk() });
    case "Finish":
      return change(world, { _tag: "act", action: "advance", walkthrough: needWalk() });
    case "Exit":
      return change(world, { _tag: "act", action: "exit", walkthrough: needWalk() });
    case "Reset":
      return change(world, { _tag: "reset", walkthrough: needWalk() });
    case "MarkDone":
      return change(world, { _tag: "markDone", task: needTask() });
    case "MarkTodo":
      return change(world, { _tag: "markTodo", task: needTask(), checklist: "home" });
    case "Toggle":
      return change(world, { _tag: "toggle", task: needTask(), checklist: "home" });
    case "Skip":
      return change(world, { _tag: "skip", task: needTask(), checklist: "home" });
    case "ContextFlips": {
      const id = needTask();
      return change({ ...world, verdict: { ...world.verdict, [id]: !world.verdict[id] } }, { _tag: "contextChanged" });
    }
    case "Join":
      return join(harness, world);
    case "Hear": {
      const read = parseRecord(world.storage);
      return change(world, { _tag: "heard", read }, { _tag: "arrived" });
    }
    case "Reload": {
      const fresh: World = { ...world, model: initialModel(harness.bare, userRecordAt(LOADING)), given: harness.bare };
      const read = parseRecord(world.storage);
      if (!read.ok) throw new Error("The shared record cannot be read.");
      return change(fresh, { _tag: "loaded", read });
    }
    case "AStarts": {
      const id = needWalk().id;
      return aWrites(world, (record) => (record.walkthroughs[id] = progressAt("running", world.now + 1000)));
    }
    case "AFinishes":
    case "AFinishesTicking": {
      const id = needWalk().id;
      const ticking = action.startsWith("AFinishesTicking");
      return aWrites(world, (record) => {
        record.walkthroughs[id] = progressAt("finished", world.now + 1000);
        if (!ticking) return;
        for (const t of TASKS) if (setup.walkOf[t] === id && !setup.cond.includes(t)) record.tasks[t] = "done";
      });
    }
    case "ATicks": {
      const id = needTask();
      return aWrites(world, (record) => (record.tasks[id] = "done"));
    }
    case "AUnticks": {
      const id = needTask();
      return aWrites(world, (record) => (record.tasks[id] = setup.cond.includes(id) ? "reopened" : "absent"));
    }
    default:
      throw new Error(`The harness has no move for the action ${action}.`);
  }
}

// ─── Where the code and the model differ ───────────────────────────────────

const progOf = (progress: WalkthroughProgress | undefined): Prog =>
  progress === undefined ? "none" : progress.status === "running" ? (progress.collapsed ? "collapsed" : "running") : progress.status;

function differences(harness: Harness, world: World, state: ModelState): string[] {
  const found: string[] = [];
  const differ = (name: string, real: unknown, model: unknown) => {
    if (JSON.stringify(real) !== JSON.stringify(model)) found.push(`${name}: the code has ${JSON.stringify(real)}, the model ${JSON.stringify(model)}`);
  };
  const { userRecord } = world.model;
  const opened = openId(runStateOf(world.model, world.given));
  for (const id of WALKS) {
    differ(`prog[${id}]`, progOf(userRecord.walkthroughProgressById[id]), state.prog[id]);
    differ(`open[${id}]`, opened === id, state.prog[id] === "running");
    differ(`sprog[${id}]`, progOf(world.storage?.walkthroughs[id]), state.sprog[id]);
  }
  for (const id of TASKS) {
    differ(`mem[${id}]`, userRecord.taskStatusById[id] ?? "absent", state.mem[id]);
    differ(`stasks[${id}]`, world.storage?.tasks[id] ?? "absent", state.stasks[id]);
  }
  differ("joined", world.given.walkthroughsAndChecklistsInUse.checklistDefinitions.length > 0, state.joined);
  // A set in the model: the same events, in any order.
  const sameEvents = world.said.length === state.said.length && world.said.every((event) => state.said.includes(event));
  if (!sameEvents) differ("said", world.said, state.said);
  if (!state.joined) return found;
  // What each checklist shows: its rows' statuses and walkthroughs, and whether it is complete.
  for (const definition of harness.lists) {
    const shown = checklistNow(world.model.views, world.given, definition)?.value;
    const ids = LISTS[definition.name as keyof typeof LISTS];
    differ(
      `${definition.name} rows`,
      shown?.tasks.map((row) => [row.status, row.walkthrough]),
      ids.map((id) => {
        const prog = state.prog[harness.setup.walkOf[id]];
        return [shows(state.mem[id]), prog === "running" ? "open" : prog === "collapsed" ? "collapsed" : "none"];
      }),
    );
    differ(`${definition.name} complete`, shown?.complete, ids.every((id) => shows(state.mem[id]) !== "todo"));
  }
  return found;
}

function configFor(setup: Setup): string {
  return [
    "CONSTANTS",
    `  WalkOf <- ${setup.walkOf === SHARED ? "Shared" : "Apart"}`,
    `  Cond <- ${setup.cond.length === 0 ? "NoTasks" : "OnlyB"}`,
    '  MountRule = "code"',
    `SPECIFICATION ${setup.spec}`,
    ...(setup.constraint === undefined ? [] : [`CONSTRAINT ${setup.constraint}`]),
    "",
  ].join("\n");
}

function conformanceFor(setup: Setup): Conformance<ModelState, World> {
  const harness = harnessFor(setup);
  return {
    start: (state) => ({
      model: initialModel(harness.bare, userRecordAt(READY)),
      given: harness.bare,
      // A reload checks stored progress against the wall clock, so the walk's clock starts at it.
      now: Date.now(),
      storage: null,
      verdict: state.verdict,
      said: [],
    }),
    act: (world, action) => act(harness, world, action),
    differences: (world, state) => differences(harness, world, state),
  };
}

it.concurrent.for(setups.map((setup) => [setup.name, setup] as const))("%s", async ([, setup]) => {
  const graph = await dumpGraph(
    {
      dir: import.meta.dirname,
      modules: ["Tasks.tla", "MCTasks.tla", "ConformanceTasks.tla"],
      spec: "ConformanceTasks.tla",
      config: configFor(setup),
    },
    modelState,
  );
  expect(graph.initial.length).toBeGreaterThan(0);
  expect(conform(graph, conformanceFor(setup))).toBeGreaterThan(0);
});
