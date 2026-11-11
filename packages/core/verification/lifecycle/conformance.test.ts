import { expect, it } from "vitest";
import { isUnverified, LOADING, userRecordAt } from "../../src/run/record";
import { initialModel, runStateOf, update } from "../../src/run/update";
import { openId } from "../../src/run/walkthroughs";
import type { Command, Given, Model, Msg } from "../../src/state";
import type { Action } from "../../src/run/types";
import type { Walkthrough, WalkthroughProgress } from "../../src/walkthrough/types";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";
import { conform, type Conformance } from "../tla/conform";
import { dumpGraph } from "../tla/tlc";
import { asBoolean, asList, asNumber, asOneOf, asString, field, type Value } from "../tla/values";

// Each pair is one ConformanceLifecycle.tla config: the first walkthrough has
// two steps here and three in another tab's release, the second has one.
type Pair = Readonly<{ first: string; second: string; secondHint: boolean }>;
const pairs: readonly Pair[] = [
  { first: "tour", second: "hint", secondHint: true },
  { first: "tour", second: "other", secondHint: false },
];
const FIRST_STEPS = 2;
const FIRST_ELSE = 3;

// ─── The model's state ──────────────────────────────────────────────────────

const STATUSES = ["none", "running", "finished", "exited"] as const;
type Entry = Readonly<{ status: (typeof STATUSES)[number]; step: number; collapsed: boolean; fresh: boolean }>;
type Held = Readonly<{ kind: string; w: string; a: string }>;
type Input = Readonly<{ kind: string; w: string; a: string; rec: Readonly<Record<string, Entry>>; e: Entry; newer: boolean }>;

type ModelState = Readonly<{
  defined: Readonly<Record<string, boolean>>;
  loading: boolean;
  held: readonly Held[];
  progress: Readonly<Record<string, Entry>>;
  unverified: Readonly<Record<string, boolean>>;
  open: string;
  waiting: readonly string[];
  threw: boolean;
  input: Input;
}>;

const entry = (value: Value): Entry => ({
  status: asOneOf(field(value, "status"), STATUSES),
  step: asNumber(field(value, "step")),
  collapsed: asBoolean(field(value, "collapsed")),
  fresh: asBoolean(field(value, "fresh")),
});

const byId = <T>(value: Value, read: (value: Value) => T, ids: readonly string[]): Record<string, T> =>
  Object.fromEntries(ids.map((id) => [id, read(field(value, id))]));

const modelState =
  (ids: readonly string[]) =>
  (get: (name: string) => Value): ModelState => {
    const input = get("input");
    return {
      defined: byId(get("defined"), asBoolean, ids),
      loading: asBoolean(get("loading")),
      held: asList(get("held")).map((held) => ({ kind: asString(field(held, "kind")), w: asString(field(held, "w")), a: asString(field(held, "a")) })),
      progress: byId(get("progress"), entry, ids),
      unverified: byId(get("unverified"), asBoolean, ids),
      open: asString(get("open")),
      waiting: asList(get("waiting")).map(asString),
      threw: asBoolean(get("threw")),
      input: {
        kind: asString(field(input, "kind")),
        w: asString(field(input, "w")),
        a: asString(field(input, "a")),
        rec: byId(field(input, "rec"), entry, ids),
        e: entry(field(input, "e")),
        newer: asBoolean(field(input, "newer")),
      },
    };
  };

// ─── The real Run, driven as run.ts drives it ──────────────────────────────

type World = Readonly<{ model: Model; given: Given; now: number; threw: boolean }>;

type Harness = Readonly<{
  ids: readonly string[];
  definitions: ReadonlyMap<string, Walkthrough>;
  steps: (id: string) => number;
}>;

function harnessFor({ first, second, secondHint }: Pair): Harness {
  const definitions = new Map<string, Walkthrough>([
    [first, defineWalkthrough({ id: first, steps: Array.from({ length: FIRST_STEPS }, () => ({})) })],
    [second, defineWalkthrough({ id: second, steps: [{}], ...(secondHint ? { dismiss: "exit" as const } : {}) })],
  ]);
  return { ids: [first, second], definitions, steps: (id) => definitionOf({ definitions }, id).steps.length };
}

function definitionOf(harness: Pick<Harness, "definitions">, id: string): Walkthrough {
  const walkthrough = harness.definitions.get(id);
  if (walkthrough === undefined) throw new Error(`No walkthrough ${id}`);
  return walkthrough;
}

// run.ts take: the definition reaches Given before the Msg is sent. Given
// keeps the model's Order, the order verifyAll follows, and a new object only
// when a definition is new, as take does.
function take(harness: Harness, world: World, id: string): World {
  const inUse = world.given.walkthroughsAndChecklistsInUse;
  if (inUse.walkthroughsById.has(id)) return world;
  const walkthroughsById = new Map(harness.ids.filter((one) => one === id || inUse.walkthroughsById.has(one)).map((one) => [one, definitionOf(harness, one)]));
  return { ...world, given: { ...world.given, walkthroughsAndChecklistsInUse: { ...inUse, walkthroughsById } } };
}

// run.ts step: the model is assigned only once update returns.
function send(world: World, msg: Msg): World {
  try {
    const { model } = update(world.model, world.given, msg, { now: world.now, verdicts: () => new Map() });
    return { ...world, model, threw: false };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { ...world, threw: true };
  }
}

// A stale entry's stepCount is another release's: one step more than this one's.
function stored(harness: Harness, id: string, given: Entry, changedAt: number): WalkthroughProgress {
  const steps = harness.steps(id);
  if (given.status === "none") throw new Error("No entry to store.");
  if (given.status !== "running") return { status: given.status, step: 0, stepCount: steps, collapsed: false, changedAt };
  return { status: "running", step: given.step, stepCount: given.fresh ? steps : steps + 1, collapsed: given.collapsed, changedAt };
}

function commandOf(harness: Harness, input: Input): Command {
  const walkthrough = definitionOf(harness, input.w);
  switch (input.kind) {
    case "start":
      return { _tag: "start", walkthrough, fromChecklist: undefined };
    case "act":
      return { _tag: "act", action: input.a as Action, walkthrough };
    case "reset":
      return { _tag: "reset", walkthrough };
    default:
      throw new Error(`No command ${input.kind}`);
  }
}

function act(harness: Harness, before: World, action: string, to: ModelState): World {
  const world = { ...before, now: before.now + 1 };
  const { input } = to;
  switch (action) {
    case "Command":
      return send(take(harness, world, input.w), commandOf(harness, input));
    case "RequestStart":
      return send(take(harness, world, input.w), { _tag: "requestStart", walkthrough: definitionOf(harness, input.w) });
    case "Withdraw":
      return send(world, { _tag: "withdrawRequest", walkthrough: input.w });
    case "Arrive":
      return send(take(harness, world, input.w), { _tag: "arrived" });
    case "Loaded": {
      const walkthroughs: Record<string, WalkthroughProgress> = {};
      for (const id of harness.ids) {
        const given = input.rec[id];
        if (given !== undefined && given.status !== "none") walkthroughs[id] = stored(harness, id, given, world.now - 1000);
      }
      return send(world, { _tag: "loaded", read: { ok: true, value: { walkthroughs, resets: {}, tasks: {}, dropped: [] } } });
    }
    case "Heard": {
      // Another tab's record: ours, entry by entry, but for input.w's.
      const ours = world.model.userRecord.walkthroughProgressById;
      const walkthroughs: Record<string, WalkthroughProgress> = {};
      // The model's heard "none" is another tab's reset, after anything this tab did.
      const resets: Record<string, number> = {};
      for (const id of harness.ids) {
        const mine = ours[id];
        if (id !== input.w) {
          if (mine !== undefined) walkthroughs[id] = { ...mine };
        } else if (input.e.status !== "none") {
          walkthroughs[id] = stored(harness, id, input.e, input.newer || mine === undefined ? world.now : mine.changedAt - 1);
        } else {
          resets[id] = world.now;
        }
      }
      const heard = send(world, { _tag: "heard", read: { ok: true, value: { walkthroughs, resets, tasks: {}, dropped: [] } } });
      if (heard.threw) return heard;
      const arrived = send(heard, { _tag: "arrived" });
      return arrived.threw ? { ...heard, threw: true } : arrived;
    }
    default:
      throw new Error(`The harness has no move for the action ${action}.`);
  }
}

/** Where the real Run differs from the model's state, in the model's names. */
function differences(harness: Harness, world: World, state: ModelState): string[] {
  const found: string[] = [];
  const differ = (name: string, real: unknown, model: unknown) => {
    if (JSON.stringify(real) !== JSON.stringify(model)) found.push(`${name}: the code has ${JSON.stringify(real)}, the model ${JSON.stringify(model)}`);
  };
  const { model, given } = world;
  const { userRecord } = model;
  const inUse = given.walkthroughsAndChecklistsInUse.walkthroughsById;
  for (const id of harness.ids) {
    const real = userRecord.walkthroughProgressById[id];
    const modelled = state.progress[id];
    if (modelled === undefined) throw new Error(`The model has no progress for ${id}`);
    differ(`progress[${id}].status`, real?.status ?? "none", modelled.status);
    if (modelled.status === "running" && real !== undefined) {
      differ(`progress[${id}].step`, real.step, modelled.step);
      differ(`progress[${id}].collapsed`, real.collapsed, modelled.collapsed);
      differ(`progress[${id}].fresh`, real.stepCount === harness.steps(id), modelled.fresh);
    }
    differ(`unverified[${id}]`, isUnverified(userRecord, id), state.unverified[id]);
    differ(`defined[${id}]`, inUse.has(id), state.defined[id]);
  }
  const runState = runStateOf(model, given);
  differ("open", openId(runState) ?? "none", state.open);
  differ("live.openStep", model.live.openStep?.walkthrough ?? "none", state.open);
  differ("snapshot.open", model.views.run.snapshot.open?.walkthrough.id ?? "none", state.open);
  differ("waiting", model.startRequests.waitingToStart, state.waiting);
  differ("loading", userRecord.storageStatus.type === "loading", state.loading);
  differ(
    "held",
    model.held.map((held) => ({ kind: held._tag, w: "walkthrough" in held ? held.walkthrough?.id : undefined, a: held._tag === "act" ? held.action : "none" })),
    state.held,
  );
  differ("threw", world.threw, state.threw);
  // The beacon candidates: verified, defined, running and collapsed, with nothing open.
  const candidates = harness.ids.filter((id) => {
    const modelled = state.progress[id];
    const verified = state.defined[id] === true && !(state.unverified[id] === true && modelled?.status !== "none");
    return state.open === "none" && verified && modelled?.status === "running" && modelled.collapsed;
  });
  const real = new Set(model.views.run.candidates.map(([walkthrough]) => walkthrough.id));
  differ("beacon candidates", harness.ids.filter((id) => real.has(id)), candidates);
  return found;
}

function configFor({ first, second, secondHint }: Pair): string {
  return [
    "CONSTANTS",
    `  First = "${first}"`,
    `  Second = "${second}"`,
    `  FirstSteps = ${FIRST_STEPS}`,
    `  FirstElse = ${FIRST_ELSE}`,
    `  SecondHint = ${secondHint ? "TRUE" : "FALSE"}`,
    "  W <- CW",
    "  Order <- COrder",
    "  Steps <- CSteps",
    "  ElseSteps <- CElseSteps",
    "  Hint <- CHint",
    "  MaxHeld = 1",
    "  Recording = TRUE",
    "SPECIFICATION Spec",
    "",
  ].join("\n");
}

function conformanceFor(pair: Pair): Conformance<ModelState, World> {
  const harness = harnessFor(pair);
  return {
    start: () => {
      const given: Given = {
        walkthroughsAndChecklistsInUse: { walkthroughsById: new Map(), checklistDefinitions: [] },
        checklistContext: undefined,
        checklistsAsked: new Map(),
      };
      return { model: initialModel(given, userRecordAt(LOADING)), given, now: Date.now(), threw: false };
    },
    act: (world, action, _from, to) => act(harness, world, action, to),
    differences: (world, state) => differences(harness, world, state),
  };
}

it.concurrent.for(pairs.map((pair) => [`${pair.first} and ${pair.second}${pair.secondHint ? ", a hint" : ""}`, pair] as const))(
  "walks every move of %s through the real update",
  async ([, pair]) => {
    const graph = await dumpGraph(
      { dir: import.meta.dirname, modules: ["Lifecycle.tla", "ConformanceLifecycle.tla"], spec: "ConformanceLifecycle.tla", config: configFor(pair) },
      modelState([pair.first, pair.second]),
    );
    expect(graph.initial.length).toBe(1);
    expect(conform(graph, conformanceFor(pair))).toBeGreaterThan(0);
  },
);
