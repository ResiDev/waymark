// Walks every move of the storage model's state graph on two real Runs sharing the scripted backend, and fails at the
// first place they differ. A Run's link is a closure that cannot be copied, so each move replays its path from the start.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defineChecklists } from "../../src/checklists/checklists";
import { createRun } from "../../src/run/run";
import type { Run } from "../../src/run/types";
import type { StoredRecord } from "../../src/storage/records";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";
import { conform } from "../tla/conform";
import { dumpGraph } from "../tla/tlc";
import { asBoolean, asList, asNumber, asOneOf, asString, field } from "../tla/values";
import type { Value } from "../tla/values";
import { backend } from "./backend";
import type { Backend, Options } from "./backend";

// ---- The model's state, read from TLC. ----

type Entry = Readonly<{ s: "none" | "running" | "finished"; c: boolean; at: number }>;
/** A record, or one of the model's sentinels in its `task`: "unreadable" or "failed". */
type Rec = Readonly<{ w: Entry; task: string }>;
type Change = Readonly<{ w: Entry | "keep"; task: string; replace: boolean }>;
type Tab = Readonly<{
  status: "loading" | "ready" | "error" | "unreadable";
  mem: Rec;
  held: readonly string[];
  connected: boolean;
  subscribed: boolean;
  load: "idle" | "asked" | "answered" | "done";
  loadValue: Rec;
  phase: "idle" | "loading" | "storing";
  storeValue: Rec;
  sent: readonly Change[];
  toHear: readonly Rec[];
  notified: boolean;
}>;
type State = Readonly<{ stored: Rec; writer: number; clock: number; tabs: readonly Tab[] }>;

const entryOf = (value: Value): Entry => ({
  s: asOneOf(field(value, "s"), ["none", "running", "finished", "keep"] as const) as Entry["s"],
  c: asBoolean(field(value, "c")),
  at: asNumber(field(value, "at")),
});
const recOf = (value: Value): Rec => ({ w: entryOf(field(value, "w")), task: asString(field(value, "task")) });
const changeOf = (value: Value): Change => {
  const w = entryOf(field(value, "w"));
  return { w: (w.s as string) === "keep" ? "keep" : w, task: asString(field(value, "task")), replace: asBoolean(field(value, "replace")) };
};
const tabOf = (value: Value): Tab => ({
  status: asOneOf(field(value, "status"), ["loading", "ready", "error", "unreadable"] as const),
  mem: recOf(field(value, "mem")),
  held: asList(field(value, "held")).map(asString),
  connected: asBoolean(field(value, "connected")),
  subscribed: asBoolean(field(value, "subscribed")),
  load: asOneOf(field(value, "load"), ["idle", "asked", "answered", "done"] as const),
  loadValue: recOf(field(value, "loadValue")),
  phase: asOneOf(field(value, "phase"), ["idle", "loading", "storing"] as const),
  storeValue: recOf(field(value, "storeValue")),
  sent: asList(field(value, "sent")).map(changeOf),
  toHear: asList(field(value, "toHear")).map((told) => recOf(field(told, "record"))),
  notified: asBoolean(field(value, "notified")),
});
const toState = (get: (name: string) => Value): State => ({
  stored: recOf(get("stored")),
  writer: asNumber(get("writer")),
  clock: asNumber(get("clock")),
  tabs: asList(get("tabs")).map(tabOf),
});

// ---- The model's values as the real code holds them. ----

const BASE = 1_000_000;
const SECOND = 1_000;
const NEWER = { version: 2 };
const hint = defineWalkthrough({ id: "hint", steps: [{}] });
const checklist = defineChecklists({ tasks: { t: {} } }).checklists.main;

const progressOf = (entry: Entry) =>
  entry.s === "none" ? undefined : { status: entry.s, step: 0, stepCount: 1, collapsed: entry.c, changedAt: BASE + entry.at * SECOND };

/** What the store holds for a record of the model: null when empty, a newer version's record when unreadable. */
function storedOf(rec: Rec): unknown {
  if (rec.task === "unreadable") return NEWER;
  const progress = progressOf(rec.w);
  if (progress === undefined && rec.task === "todo") return null;
  return { version: 1, walkthroughs: progress === undefined ? {} : { hint: progress }, tasks: rec.task === "todo" ? {} : { t: rec.task } };
}

/** A save's changes, as RecordChanges. */
function changesOf(change: Change): unknown {
  const set = { walkthroughs: {} as Record<string, unknown>, tasks: {} as Record<string, string> };
  const remove = { walkthroughs: [] as string[], tasks: [] as string[] };
  if (change.w !== "keep") {
    const progress = progressOf(change.w);
    if (progress !== undefined) set.walkthroughs["hint"] = progress;
    else if (!change.replace) remove.walkthroughs.push("hint");
  }
  if (change.task === "done" || change.task === "reopened") set.tasks["t"] = change.task;
  else if (change.task === "todo" && !change.replace) remove.tasks.push("t");
  return change.replace ? { version: 1, set, remove, replace: true } : { version: 1, set, remove };
}

/** Keys sorted, so two values that hold the same print the same. */
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== "object" || value === null) return value;
  // oxlint-disable-next-line unicorn/no-array-sort -- the lib in tsconfig has no toSorted; Object.entries gives a fresh array.
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sorted(inner)]));
};
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const show = (value: unknown) => JSON.stringify(sorted(value));

// ---- The real side: two Runs on one backend, built by replaying a path. ----

type Real = {
  net: Backend;
  runs: Run[];
  disconnect: ((() => void) | undefined)[];
  replace: (((record: StoredRecord | null) => void) | undefined)[];
  /** recordUnreadable reports, per tab. */
  reports: number[];
  /** Whether the last move's reports matched turnedUnreadable. */
  problems: string[];
};
type Step = Readonly<{ action: string; from: State; to: State }>;
type World = { steps: readonly Step[]; real: Real | undefined };

function fresh(options: Options): Real {
  vi.setSystemTime(BASE);
  const net = backend(null, options);
  const real: Real = { net, runs: [], disconnect: [undefined, undefined], replace: [undefined, undefined], reports: [0, 0], problems: [] };
  for (const index of [0, 1]) {
    const run = createRun({
      storage: net.tab(),
      problemHandlers: {
        recordUnreadable: (problem) => {
          real.reports[index] = (real.reports[index] ?? 0) + 1;
          real.replace[index] = problem.replace;
        },
        storageFailed: () => {},
      },
    });
    // The Run knows the hint and the checklist from the start, as a page that renders them hands them over.
    run.requestStart(hint)();
    run.checklist(checklist);
    real.runs.push(run);
  }
  return real;
}

/** The tab the move changed, by what changed in it. */
function tabWhere(from: State, to: State, changed: (before: Tab, after: Tab) => boolean): number {
  const found = [0, 1].filter((index) => changed(from.tabs[index]!, to.tabs[index]!));
  if (found.length !== 1) throw new Error(`Cannot tell which tab moved: ${found.length} match`);
  return found[0]!;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The command a tab's record shows: start and request do the same to a walkthrough with no progress. */
function commandOf(before: Rec, after: Rec): string {
  if (before.task !== after.task) return "tick";
  if (after.w.s === "none") return "reset";
  if (after.w.s === "finished") return "finish";
  return before.w.s === "none" ? "request" : "start";
}

function command(run: Run, name: string) {
  switch (name) {
    case "tick":
      return run.checklist(checklist).toggle("t");
    case "start":
      return run.start(hint);
    case "request":
      return void run.requestStart(hint);
    case "finish":
      return run.act("advance");
    case "reset":
      return run.reset(hint);
  }
  throw new Error(`Unknown command ${name}`);
}

function apply(real: Real, { action, from, to }: Step) {
  const { net, runs } = real;
  const before = [...real.reports];
  switch (action) {
    case "Tick":
      vi.setSystemTime(BASE + to.clock * SECOND);
      break;
    case "Command": {
      const index = tabWhere(from, to, (a, b) => !sameJson(a.held, b.held) || !sameJson(a.mem, b.mem));
      const tab = from.tabs[index]!;
      command(runs[index]!, tab.status === "loading" ? to.tabs[index]!.held[0]! : commandOf(tab.mem, to.tabs[index]!.mem));
      break;
    }
    case "Replace": {
      const index = tabWhere(from, to, (a, b) => a.status === "unreadable" && b.status !== "unreadable");
      const replace = real.replace[index];
      if (replace === undefined) throw new Error(`Tab ${index} was handed no replace`);
      replace(null);
      break;
    }
    case "Connect": {
      const index = tabWhere(from, to, (a, b) => !a.connected && b.connected);
      real.disconnect[index] = runs[index]!.connect();
      break;
    }
    case "Disconnect": {
      const index = tabWhere(from, to, (a, b) => a.connected && !b.connected);
      real.disconnect[index]?.();
      break;
    }
    case "LoadAnswer": {
      const index = tabWhere(from, to, (a, b) => a.load !== b.load);
      net.readLoad(index, to.tabs[index]!.loadValue.task === "failed");
      break;
    }
    case "LoadArrive":
      net.deliverLoad(tabWhere(from, to, (a, b) => a.load !== b.load));
      break;
    case "Hear":
      // The tab that took a record in. Hearing may save, and that save can tell the other tab.
      net.hear(tabWhere(from, to, (a, b) => b.toHear.length < a.toHear.length || (a.notified && !b.notified)));
      break;
    case "WholeLoaded": {
      const index = tabWhere(from, to, (a, b) => a.phase === "loading" && !sameJson(a, b));
      net.answerLoad(index, to.tabs[index]!.phase === "idle" && from.stored.task !== "unreadable");
      break;
    }
    case "WholeStored":
      net.land(to.writer - 1);
      break;
    case "WholeStoreFailed":
      net.failSave(tabWhere(from, to, (a, b) => a.phase === "storing" && b.phase === "idle"));
      break;
    case "PartialLanded":
    case "PartialFailed": {
      const index = tabWhere(from, to, (a, b) => a.sent.length !== b.sent.length);
      const sent = from.tabs[index]!.sent;
      const at = sent.findIndex((_, i) => sameJson([...sent.slice(0, i), ...sent.slice(i + 1)], to.tabs[index]!.sent));
      if (action === "PartialLanded") net.land(index, at);
      else net.failSave(index, at);
      break;
    }
    case "DeviceWrite":
      net.put(NEWER);
      break;
    default:
      throw new Error(`No real move for ${action}`);
  }
  // turnedUnreadable: recordUnreadable is reported once, on the change into unreadable.
  real.problems = [0, 1].flatMap((index) => {
    const expected = from.tabs[index]!.status !== "unreadable" && to.tabs[index]!.status === "unreadable" ? 1 : 0;
    const got = (real.reports[index] ?? 0) - (before[index] ?? 0);
    return got === expected ? [] : [`tab ${index + 1} reported recordUnreadable ${got} times, the model ${expected}`];
  });
}

function differences(real: Real, state: State): string[] {
  const { net, runs } = real;
  const problems = [...real.problems];
  if (!same(net.stored(), storedOf(state.stored))) problems.push(`stored: ${show(net.stored())}, the model ${show(storedOf(state.stored))}`);
  state.tabs.forEach((tab, index) => {
    const run = runs[index]!;
    const name = `tab ${index + 1}`;
    const snapshot = run.getSnapshot();
    if (snapshot.storageStatus !== tab.status) problems.push(`${name} status: ${snapshot.storageStatus}, the model ${tab.status}`);
    const progress = snapshot.progress["hint"];
    const expected = progressOf(tab.mem.w);
    if (!same(progress, expected)) problems.push(`${name} hint: ${show(progress)}, the model ${show(expected)}`);
    const row = run.checklist(checklist).getSnapshot().tasks[0]?.status;
    const shows = tab.mem.task === "reopened" ? "todo" : tab.mem.task;
    if (row !== shows) problems.push(`${name} task: ${row}, the model ${tab.mem.task}`);
    const isOpen = snapshot.open?.walkthrough.id === "hint";
    const modelOpen = tab.mem.w.s === "running" && !tab.mem.w.c;
    if (isOpen !== modelOpen) problems.push(`${name} open: ${isOpen}, the model ${modelOpen}`);
    const side = net.side(index);
    if (side.listening !== tab.subscribed) problems.push(`${name} listening: ${side.listening}, the model ${tab.subscribed}`);
    const toHear = tab.toHear.map(storedOf);
    if (!same(side.toHear, toHear)) problems.push(`${name} told of: ${show(side.toHear)}, the model ${show(toHear)}`);
    if (side.notified !== tab.notified) problems.push(`${name} notified: ${side.notified}, the model ${tab.notified}`);
    // Its load at connect, and a save adapter's load before a save: at most one is out at a time.
    const loads = (tab.load === "asked" || tab.load === "answered" ? 1 : 0) + (tab.phase === "loading" ? 1 : 0);
    if (side.loads !== loads) problems.push(`${name} loads out: ${side.loads}, the model ${loads}`);
    if ((side.read !== undefined) !== (tab.load === "answered")) problems.push(`${name} load answered: ${side.read !== undefined}, the model ${tab.load}`);
    const saves = tab.phase === "storing" ? [storedOf(tab.storeValue)] : tab.sent.map(changesOf);
    if (!same(side.saves, saves)) problems.push(`${name} saves out: ${show(side.saves)}, the model ${show(saves)}`);
  });
  return problems;
}

// ---- The walks. ----

const dir = import.meta.dirname;

/** Adapter options from a config's constants. */
function optionsOf(config: string): Options {
  const constant = (name: string) => new RegExp(`${name} = (\\S+)`).exec(config)?.[1];
  return {
    kind: constant("Adapter") === '"whole"' ? "whole" : "partial",
    async: constant("Async") === "TRUE",
    tellsOwnWrites: constant("TellsOwnWrites") === "TRUE",
    hearCurrent: constant("HearCurrent") === "TRUE",
  };
}

describe("the storage model and the real Runs", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it.each([
    ["a server that pushes every write, its saves landing in any order", "ConformanceRemote.cfg"],
    ["a server that pushes every write, with saves failing", "ConformanceRemoteFailures.cfg"],
    ["a tab that disconnects and connects again", "ConformanceUnmounts.cfg"],
    ["a save adapter that answers later, with loads and saves failing", "ConformanceSaveAsync.cfg"],
    ["localStorage, with a newer version written and replaced", "ConformanceLocal.cfg"],
  ])("moves alike on %s", async (_, file) => {
    const config = readFileSync(join(dir, file), "utf8");
    const options = optionsOf(config);
    const graph = await dumpGraph({ dir, modules: ["Storage.tla", "MCStorage.tla"], spec: "MCStorage.tla", config }, toState);
    const replay = (steps: readonly Step[]): Real => {
      const real = fresh(options);
      for (const step of steps) apply(real, step);
      return real;
    };
    const checked = conform<State, World>(graph, {
      start: () => ({ steps: [], real: replay([]) }),
      act: (world, action, from, to) => {
        const steps = [...world.steps, { action, from, to }];
        return { steps, real: replay(steps) };
      },
      differences: (world, state) => {
        const real = world.real ?? replay(world.steps);
        const found = differences(real, state);
        // Rebuilt from the path when needed: two Runs per state would not fit in memory.
        world.real = undefined;
        return found;
      },
    });
    expect(checked).toBeGreaterThan(0);
  });
});
