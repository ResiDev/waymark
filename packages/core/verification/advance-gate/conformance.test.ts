import { expect, it } from "vitest";
import { whereClicked } from "../../src/run/input";
import { READY, userRecordAt } from "../../src/run/record";
import { liveWatchers, needsAdvanceRead, stepAt } from "../../src/run/rules";
import type { OnStep } from "../../src/run/rules";
import type { Rect } from "../../src/run/types";
import { initialModel, update } from "../../src/run/update";
import { openOf } from "../../src/run/walkthroughs";
import type { Given, Message, Model, Msg, StepRead, WaymarkRead } from "../../src/state";
import type { AdvanceCondition, Step, Walkthrough } from "../../src/walkthrough/types";
import { checkOf, defineWalkthrough, selectorOf } from "../../src/walkthrough/walkthrough";
import { conform, type Conformance } from "../tla/conform";
import { dumpGraph } from "../tla/tlc";
import { asBoolean, asList, asNumber, asOneOf, asString, field, type Value } from "../tla/values";


// The model's tick. LostAfter, WaitingAfter, MissingAfter and DelayCap in
// AdvanceGate.tla count these, so 200ms, 500ms, 750ms and 250ms fall where the
// model's thresholds do.
const TICK_MS = 250;
const MISSING_AFTER_MS = 750;
const TIME_CAP = 3;
const DELAY_CAP = 1;

type Kind = "none" | "click" | "event" | "state";
type Then = "advance" | "unlock";
type StepConfig = Readonly<{ kind: Kind; waymark: boolean; then: Then; delay: number }>;
type PageState = "none" | "hidden" | "shown";

// Every definition of a step that the walkthrough validation accepts, as MeetableSteps in MCAdvanceGate.tla.
const everyStep: StepConfig[] = [
  { kind: "none", waymark: false, then: "advance", delay: 0 },
  { kind: "none", waymark: true, then: "advance", delay: 0 },
];
for (const kind of ["click", "event", "state"] as const) {
  for (const waymark of [false, true]) {
    if (kind !== "state" && !waymark) continue;
    for (const then of ["advance", "unlock"] as const) {
      for (const delay of [0, 1]) everyStep.push({ kind, waymark, then, delay });
    }
  }
}
const pairs = everyStep.flatMap((first) => (["click", "event"] as const).map((second) => ({ first, second })));

// ─── The model's state ──────────────────────────────────────────────────────

type QueuedInModel = Readonly<{ type: "click" | "event"; hit: string; fresh: boolean }>;

type ModelState = Readonly<{
  page: readonly PageState[];
  holds: boolean;
  attached: boolean;
  status: "running" | "finished";
  step: number;
  collapsed: boolean;
  start: string;
  looked: boolean;
  gate: string;
  gateAge: number;
  location: string;
  unseenFor: number;
  seen: boolean;
  inbox: readonly QueuedInModel[];
}>;

const modelState = (get: (name: string) => Value): ModelState => ({
  page: asList(get("page")).map((value) => asOneOf(value, ["none", "hidden", "shown"] as const)),
  holds: asBoolean(get("holds")),
  attached: asBoolean(get("attached")),
  status: asOneOf(get("status"), ["running", "finished"] as const),
  step: asNumber(get("step")),
  collapsed: asBoolean(get("collapsed")),
  start: asString(get("start")),
  looked: asBoolean(get("looked")),
  gate: asString(get("gate")),
  gateAge: asNumber(get("gateAge")),
  location: asString(get("location")),
  unseenFor: asNumber(get("unseenFor")),
  seen: asBoolean(get("seen")),
  inbox: asList(get("inbox")).map((message) => ({
    type: asOneOf(field(message, "type"), ["click", "event"] as const),
    hit: asString(field(message, "hit")),
    fresh: asBoolean(field(message, "fresh")),
  })),
});

const isOpen = (state: ModelState) => state.status === "running" && !state.collapsed;
const nextEnabled = (state: ModelState) => isOpen(state) && (state.gate === "unlocked" || state.location === "lost" || state.location === "missing");

// ─── The real Run, driven as the page would drive it ───────────────────────

const RECT: Rect = { x: 10, y: 10, top: 10, right: 60, bottom: 30, left: 10, width: 50, height: 20 };
const EVENT = "waymark-fired";

let holdsNow = false;

function stepOf(config: StepConfig, index: number): Step {
  const options = { then: config.then, delayMs: config.delay * TICK_MS };
  const advance: AdvanceCondition | undefined =
    config.kind === "click"
      ? { click: true, ...options }
      : config.kind === "event"
        ? { event: EVENT, ...options }
        : config.kind === "state"
          ? { state: () => holdsNow, ...options }
          : undefined;
  return {
    ...(config.waymark ? { waymark: `step-${index}` } : {}),
    ...(advance === undefined ? {} : { advance }),
    missingAfterMs: MISSING_AFTER_MS,
  };
}

type World = Readonly<{ model: Model; now: number; attached: boolean; page: readonly PageState[]; holds: boolean; inbox: readonly Msg[] }>;

type Harness = Readonly<{
  walkthrough: Walkthrough;
  given: Given;
  elements: readonly HTMLElement[];
}>;

function harnessFor(pair: (typeof pairs)[number]): Harness {
  const second: StepConfig = { kind: pair.second, waymark: true, then: "unlock", delay: 0 };
  const walkthrough = defineWalkthrough({ id: "tour", steps: [stepOf(pair.first, 0), stepOf(second, 1)] });
  const given: Given = {
    walkthroughsAndChecklistsInUse: { walkthroughsById: new Map([[walkthrough.id, walkthrough]]), checklistDefinitions: [] },
    checklistContext: undefined,
    checklistsAsked: new Map(),
  };
  const elements = [0, 1].map((index) => {
    const element = document.createElement("button");
    element.dataset["waymark"] = `step-${index}`;
    return element;
  });
  return { walkthrough, given, elements };
}

// Only the elements in the page are connected, as whereClicked checks.
function showPage(harness: Harness, page: readonly PageState[]) {
  harness.elements.forEach((element, index) => {
    if (page[index] === "none") element.remove();
    else if (!element.isConnected) document.body.append(element);
  });
}

function send(harness: Harness, world: World, msg: Msg): World {
  return { ...world, model: update(world.model, harness.given, msg, { now: world.now, verdicts: () => new Map() }).model };
}

const page = (message: Message): Msg => ({ _tag: "page", message });

const runStateOf = (harness: Harness, world: World) => ({
  walkthroughsAndChecklistsInUse: harness.given.walkthroughsAndChecklistsInUse,
  userRecord: world.model.userRecord,
  live: world.model.live,
});

const openIn = (harness: Harness, world: World): OnStep | undefined => openOf(runStateOf(harness, world));

// page.ts measure, for an element the page holds in one of three ways.
function measure(harness: Harness, world: World, index: number): WaymarkRead {
  const element = harness.elements[index] ?? null;
  const shows = world.page[index];
  if (shows === "none" || element === null) return { element: null, rect: null, inView: false };
  return shows === "hidden" ? { element, rect: null, inView: false } : { element, rect: RECT, inView: true };
}

// page.ts readStep
function readStep(harness: Harness, world: World, on: OnStep, asLooked: boolean): StepRead | undefined {
  const index = on.walkthroughProgress.step;
  const step = stepAt(on.walkthrough, index);
  const waymark = selectorOf(step) === undefined ? undefined : measure(harness, world, index);
  if (!needsAdvanceRead(on, asLooked)) return waymark === undefined ? undefined : { now: world.now, waymark };
  holdsNow = world.holds;
  const holds = checkOf(step)?.(waymark?.element ?? null) === true;
  return { now: world.now, waymark, advance: { holds } };
}

// page.ts onClick, on the element of the step that shows.
function clickOnWaymark(harness: Harness, world: World, on: OnStep): Msg {
  const element = harness.elements[on.walkthroughProgress.step];
  if (element === undefined) throw new Error("No element to click.");
  const location = on.stepState.waymark.location;
  const context = { dismiss: on.walkthrough.dismiss ?? "collapse", element: on.stepState.waymark.element, rect: location.status === "found" ? location.rect : null, padding: 0, ui: { dialog: null } };
  let hit: ReturnType<typeof whereClicked> | undefined;
  element.addEventListener("click", (event) => (hit = whereClicked(event, context)), { once: true });
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 20, clientY: 20 }));
  if (hit === undefined) throw new Error("The click did not reach the waymark.");
  return page({ type: "click", showingId: on.stepState.showingId, hit, now: world.now });
}

function waymarkFires(world: World, on: OnStep): Msg {
  const listening = liveWatchers(on).waymarkEvents;
  if (listening === undefined) throw new Error("The Run does not listen to the waymark's events.");
  return page({ type: "event", showingId: listening.visit, now: world.now });
}

function act(harness: Harness, world: World, action: string, to: ModelState): World {
  const { walkthrough } = harness;
  const on = () => {
    const open = openIn(harness, world);
    if (open === undefined) throw new Error(`${action}: no walkthrough is open.`);
    return open;
  };
  switch (action) {
    case "Look":
      return send(harness, world, page({ type: "look", showingId: on().stepState.showingId, read: readStep(harness, world, on(), true) }));
    case "Frame": {
      const read = readStep(harness, world, on(), false);
      if (read === undefined) throw new Error("The model reads a frame where the page reads nothing.");
      return send(harness, world, page({ type: "stepRead", showingId: on().stepState.showingId, read }));
    }
    case "Tick":
      return { ...world, now: world.now + TICK_MS };
    case "PageChanges":
      return { ...world, page: to.page };
    case "AppStateFlips":
      return { ...world, holds: to.holds };
    case "Attach":
      return send(harness, { ...world, attached: true }, { _tag: "attached" });
    case "Detach":
      return send(harness, { ...world, attached: false }, { _tag: "detached" });
    case "UserClicksWaymark":
      return send(harness, world, clickOnWaymark(harness, world, on()));
    case "UserClicksWaymarkQueued":
      return { ...world, inbox: [...world.inbox, clickOnWaymark(harness, world, on())] };
    case "WaymarkFires":
      return send(harness, world, waymarkFires(world, on()));
    case "WaymarkFiresQueued":
      return { ...world, inbox: [...world.inbox, waymarkFires(world, on())] };
    case "QueuedArrives": {
      const [queued, ...rest] = world.inbox;
      if (queued === undefined) throw new Error("Nothing waits in the queue.");
      return send(harness, { ...world, inbox: rest }, queued);
    }
    case "UserNext":
      return send(harness, world, { _tag: "act", action: "advance", walkthrough });
    case "UserBack":
      return send(harness, world, { _tag: "act", action: "previous", walkthrough });
    case "UserCollapses":
      return send(harness, world, page({ type: "act", action: "collapse" }));
    case "UserResumes":
      return send(harness, world, { _tag: "act", action: "resume", walkthrough });
    case "UserStartsAgain":
      return send(harness, world, { _tag: "start", walkthrough, fromChecklist: undefined });
    default:
      throw new Error(`The harness has no move for the action ${action}.`);
  }
}

const ticksSince = (now: number, since: number, cap: number) => Math.min(cap, Math.floor((now - since) / TICK_MS));

/** Where the real Run differs from the model's state, in the model's names. */
function differences(harness: Harness, world: World, state: ModelState): string[] {
  const found: string[] = [];
  const differ = (name: string, real: unknown, model: unknown) => {
    if (real !== model) found.push(`${name}: the code has ${JSON.stringify(real)}, the model ${JSON.stringify(model)}`);
  };
  const progress = world.model.userRecord.walkthroughProgressById[harness.walkthrough.id];
  differ("status", progress?.status, state.status);
  differ("step", progress?.step, state.step);
  differ("collapsed", progress?.collapsed, state.collapsed);
  const open = world.model.views.run.snapshot.value.open;
  differ("canAdvance", open?.snapshot.canAdvance ?? false, nextEnabled(state));
  const stepState = openIn(harness, world)?.stepState;
  differ("open", stepState !== undefined, isOpen(state));
  if (stepState === undefined || !isOpen(state)) return found;
  const { gate, waymark } = stepState;
  differ("start", stepState.start, state.start);
  differ("looked", stepState.looked, state.looked);
  differ("gate", gate._tag, state.gate);
  differ("gateAge", gate._tag === "holding" || gate._tag === "met" ? ticksSince(world.now, gate.since, DELAY_CAP) : 0, state.gateAge);
  differ("location", waymark.location.status, state.location);
  differ("unseenFor", waymark.unseenSince === undefined ? -1 : ticksSince(world.now, waymark.unseenSince, TIME_CAP), state.unseenFor);
  differ("seen", waymark.element !== null, state.seen);
  const fresh = world.inbox.map((msg) => msg._tag === "page" && "showingId" in msg.message && msg.message.showingId === stepState.showingId);
  differ("inbox", JSON.stringify(fresh), JSON.stringify(state.inbox.map((queued) => queued.fresh)));
  return found;
}

/** Where the page's listeners and frame differ from the moves the model allows from this state. */
function watcherDifferences(harness: Harness, world: World, state: ModelState, actions: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const on = openIn(harness, world);
  const live = on === undefined ? undefined : liveWatchers(on);
  const differ = (name: string, real: boolean, model: boolean) => {
    if (real !== model) found.push(`${name}: the code ${real ? "allows" : "does not allow"} it, the model ${model ? "does" : "does not"}`);
  };
  const shown = state.page[state.step] === "shown";
  const inPage = state.page[state.step] !== "none";
  differ("first look", world.attached && on !== undefined && !on.stepState.looked, actions.has("Look"));
  if (state.inbox.length > 0) return found;
  differ("frame", world.attached && live?.frame === true, actions.has("Frame"));
  if (shown) differ("click on the waymark", live?.input === true, actions.has("UserClicksWaymark"));
  if (inPage) differ("the waymark's event", live?.waymarkEvents !== undefined, actions.has("WaymarkFires"));
  return found;
}

function describe(pair: (typeof pairs)[number]) {
  const { first, second } = pair;
  const condition = first.kind === "none" ? "no condition" : `${first.kind}, then ${first.then}, delay ${first.delay * TICK_MS}ms`;
  return `step 1: ${condition}, ${first.waymark ? "a waymark" : "no waymark"}; step 2: ${second} on a waymark`;
}

function configFor({ first, second }: (typeof pairs)[number]): string {
  return [
    "CONSTANTS",
    `  FirstKind = "${first.kind}"`,
    `  FirstWaymark = ${first.waymark ? "TRUE" : "FALSE"}`,
    `  FirstThen = "${first.then}"`,
    `  FirstDelay = ${first.delay}`,
    `  SecondKind = "${second}"`,
    "  FirstSteps <- OneFirst",
    "  SecondSteps <- OneSecond",
    "SPECIFICATION Spec",
    "",
  ].join("\n");
}

function conformanceFor(pair: (typeof pairs)[number]): Conformance<ModelState, World> {
  const harness = harnessFor(pair);
  return {
    start: (state) => {
      const empty: World = { model: initialModel(harness.given, userRecordAt(READY)), now: 1_000_000, attached: false, page: state.page, holds: state.holds, inbox: [] };
      return send(harness, empty, { _tag: "start", walkthrough: harness.walkthrough, fromChecklist: undefined });
    },
    act: (world, action, from, to) => {
      showPage(harness, from.page);
      return act(harness, world, action, to);
    },
    differences: (world, state) => differences(harness, world, state),
    allows: (world, state, actions) => {
      showPage(harness, state.page);
      return watcherDifferences(harness, world, state, actions);
    },
  };
}

it.concurrent.for(pairs.map((pair) => [describe(pair), pair] as const))("%s", async ([, pair]) => {
  const graph = await dumpGraph(
    { dir: import.meta.dirname, modules: ["AdvanceGate.tla", "ConformanceAdvanceGate.tla"], spec: "ConformanceAdvanceGate.tla", config: configFor(pair) },
    modelState,
  );
  expect(graph.initial.length).toBeGreaterThan(0);
  expect(conform(graph, conformanceFor(pair))).toBeGreaterThan(0);
});
