// Holds Shell.tla to the real Run. The real code runs each call of the app to its end
// at once, so the walk does not follow TLC's graph one frame at a time: it folds each
// app call and the frames it runs into one move between idle states, replays the
// calls that reach a state on a fresh Run, and compares what the Run makes public.
import { expect, it, vi } from "vitest";
import { createRun } from "../../src/run/run";
import type { Run, RunOptions } from "../../src/run/types";
import type { SavePartialAdapter } from "../../src/storage/adapter";
import type { StoredRecord } from "../../src/storage/records";
import type { Step } from "../../src/walkthrough/types";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";
import { conform, type Conformance } from "../tla/conform";
import { dumpGraph, type Graph } from "../tla/tlc";
import { asBoolean, asList, asNumber, asOneOf, field, type Value } from "../tla/values";

const SCRIPTS_1 = ["none", "throw", "throwLater", "send", "sendLater", "subscribe", "connect"] as const;
const SCRIPTS_2 = ["none", "throw", "throwLater", "sendLater", "connect"] as const;
const EVENT_SCRIPTS = ["none", "throw", "send"] as const;
// Fewer calls than MCShell.cfg, so each state graph stays small enough to dump.
const BUDGET = 3;
// High enough that no counter stops in three calls: the walk compares them exactly.
const CAP = 9;
const STEPS = 12;

type Script = (typeof SCRIPTS_1)[number] | (typeof SCRIPTS_2)[number];
type EventScript = (typeof EVENT_SCRIPTS)[number];
type Handler = "default" | "handles";

// ─── The model's state ──────────────────────────────────────────────────────

type Wiring = Readonly<{ sync: boolean; bad: boolean; handler: Handler; scripts: readonly [Script, Script]; onEvent: EventScript }>;

/** What a call threw: nothing, a raw error, or n errors of the app's. */
type Thrown = "none" | "raw" | `app:${number}`;

type Public = Readonly<{
  loading: boolean;
  open: boolean;
  step: number;
  found: boolean;
  version: number;
  calls: readonly number[];
  subscribeThrew: readonly (boolean | undefined)[];
  pageListening: boolean;
  detaches: number;
  disconnects: number;
  hearing: boolean;
  loadInFlight: boolean;
  thrown: Thrown;
  events: number;
  handled: number;
}>;

type ModelState = Readonly<{ wiring: Wiring; idle: boolean; shown: Public }>;

const thrownOf = (exc: Value): Thrown => {
  const kind = asOneOf(field(exc, "k"), ["none", "raw", "app"] as const);
  return kind === "app" ? `app:${asNumber(field(exc, "n"))}` : kind;
};

const modelState = (get: (name: string) => Value): ModelState => {
  const f = get("f");
  const pg = get("pg");
  const ln = get("ln");
  const open = asBoolean(field(f, "open"));
  const scripts = asList(get("script")).map((value) => asOneOf(value, [...SCRIPTS_1, ...SCRIPTS_2]));
  return {
    wiring: {
      sync: asBoolean(get("sync")),
      bad: asBoolean(get("bad")),
      handler: asOneOf(get("handler"), ["default", "handles"] as const),
      scripts: [scripts[0] ?? "none", scripts[1] ?? "none"],
      onEvent: asOneOf(get("onEvent"), EVENT_SCRIPTS),
    },
    idle: asList(get("todo")).length === 0 && !asBoolean(get("draining")),
    shown: {
      loading: asBoolean(field(f, "loading")),
      open,
      step: open ? asNumber(field(f, "step")) : -1,
      found: open && asBoolean(field(f, "found")),
      version: asNumber(get("version")),
      calls: asList(get("calls")).map(asNumber),
      subscribeThrew: asList(get("subResult")).map((result) => (asBoolean(field(result, "done")) ? asBoolean(field(result, "threw")) : undefined)),
      pageListening: asBoolean(field(pg, "open")),
      detaches: asNumber(field(pg, "handles")),
      disconnects: asNumber(field(ln, "handles")),
      hearing: asBoolean(field(ln, "hearing")),
      loadInFlight: asBoolean(field(ln, "inFlight")),
      thrown: thrownOf(get("result")),
      events: asNumber(get("events")),
      handled: asNumber(get("handled")),
    },
  };
};

/**
 * Folds the graph to its idle states: each app call, with every frame it runs, is one
 * move. Between idle states the model is one path, as the code is: nothing but the
 * app chooses.
 */
function idleGraph(graph: Graph<ModelState>): Graph<ModelState> {
  const states = new Map<string, ModelState>();
  const moves = new Map<string, (readonly [string, string])[]>();
  const stateOf = (id: string) => {
    const state = graph.states.get(id);
    if (state === undefined) throw new Error(`The graph has no state ${id}`);
    return state;
  };
  for (const [id, state] of graph.states) {
    if (!state.idle) continue;
    states.set(id, state);
    const out: (readonly [string, string])[] = [];
    for (const [to, action] of graph.moves.get(id) ?? []) {
      let at = to;
      for (let frames = 0; !stateOf(at).idle; frames++) {
        const next = graph.moves.get(at) ?? [];
        const only = next[0];
        if (next.length !== 1 || only === undefined) throw new Error(`After ${action}, state ${at} has ${next.length} moves, not one.`);
        if (frames > 10_000) throw new Error(`${action} from state ${id} never returns.`);
        at = only[0];
      }
      out.push([at, action]);
    }
    moves.set(id, out);
  }
  return { states, initial: graph.initial, moves };
}

// ─── The real Run, driven as the app would drive it ────────────────────────

// The page every Run looks at: one button per step, laid out where jsdom cannot.
const targets = Array.from({ length: STEPS }, (_, index) => {
  const element = document.createElement("button");
  element.dataset["waymark"] = `s${index}`;
  element.getBoundingClientRect = () => new DOMRect(20, 20, 100, 40);
  document.body.append(element);
  return element;
});

const tourFor = (bad: boolean) =>
  defineWalkthrough({
    id: "tour",
    steps: targets.map((_, index): Step => (index === 0 && bad ? { selector: "button[" } : { waymark: `s${index}` })),
  });

const capped = (count: number) => Math.min(count, CAP);

const thrownBy = (call: () => void): Thrown => {
  try {
    call();
    return "none";
  } catch (error) {
    if (error instanceof AggregateError) return `app:${error.errors.length}`;
    if (error instanceof Error && error.message.startsWith("app:")) return "app:1";
    return "raw";
  }
};

/**
 * A fresh Run wired as the model's behaviour is, after the app's calls in `trail`.
 * Only the page's input listeners are stubbed, to see whether they are open; frames
 * are swallowed, as the model has none.
 */
function play(wiring: Wiring, trail: readonly string[]): Public {
  const inputs: AbortSignal[] = [];
  const spies = [
    vi.spyOn(window, "addEventListener").mockImplementation((type: string, _listener: unknown, options?: boolean | AddEventListenerOptions) => {
      if (type === "click" && typeof options === "object" && options.signal !== undefined) inputs.push(options.signal);
    }),
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0),
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ];
  try {
    const tour = tourFor(wiring.bad);
    const calls = [0, 0];
    const subscribeThrew: (boolean | undefined)[] = [undefined, undefined];
    let notified = -1;
    let events = 0;
    let handled = 0;
    let subscribes = 0;
    let unsubscribes = 0;
    let settle: ((record: null) => void) | undefined;
    let sent = false;
    let thrown: Thrown = "none";
    const detaches: (() => void)[] = [];
    const disconnects: (() => void)[] = [];

    // A promise whose settling the walk does itself, outside any drain, as a microtask would.
    const later = { then: (onValue: (record: null) => void) => void (settle = onValue) } as unknown as Promise<StoredRecord | null>;
    const adapter: SavePartialAdapter = {
      load: () => (wiring.sync ? null : later),
      savePartial: () => {},
      subscribe: () => {
        subscribes++;
        return () => void unsubscribes++;
      },
    };
    const options: RunOptions = {
      storage: adapter,
      onEvent: () => {
        events++;
        if (wiring.onEvent === "throw") throw new Error("app: onEvent");
        if (wiring.onEvent === "send" && !sent) {
          sent = true;
          run.act("advance");
        }
      },
      ...(wiring.handler === "handles" ? { problemHandlers: { callbackThrew: () => void handled++ } } : {}),
    };
    const run: Run = createRun(options);
    // Counts the snapshots the Run notifies: the model's version. It does nothing else.
    run.subscribe(() => void notified++);

    const listener = (index: 0 | 1) => () => {
        const script = wiring.scripts[index];
        calls[index] = (calls[index] ?? 0) + 1;
        const count = calls[index];
        if (count === 1 && script === "send") run.act("advance");
        if (count === 1 && script === "connect") disconnects.push(run.connect());
        if (count === 1 && script === "subscribe") {
          try {
            run.subscribe(second);
            subscribeThrew[1] = false;
          } catch (error) {
            subscribeThrew[1] = true;
            throw error;
          }
        }
        if (count === 2 && script === "sendLater") run.act("advance");
        if (script === "throw" || (script === "throwLater" && count > 1)) throw new Error(`app: listener ${index + 1}`);
      };
    const first = listener(0);
    const second = listener(1);

    const call = (action: string) => {
      switch (action) {
        case "AppStarts":
          return run.start(tour);
        case "AppActs":
          return run.act("advance");
        case "AppSubscribes":
          try {
            run.subscribe(first);
            subscribeThrew[0] = false;
          } catch (error) {
            subscribeThrew[0] = true;
            throw error;
          }
          return;
        case "AppAttaches":
          return void detaches.push(run.attach(() => ({ dialog: null })));
        case "AppDetaches":
          return detaches.pop()?.();
        case "AppConnects":
          return void disconnects.push(run.connect());
        case "AppDisconnects":
          return disconnects.pop()?.();
        case "LoadSettles": {
          const answer = settle;
          settle = undefined;
          return answer?.(null);
        }
        default:
          throw new Error(`The walk has no call for the action ${action}.`);
      }
    };

    for (const action of trail) thrown = thrownBy(() => call(action));

    const snapshot = run.getSnapshot();
    const open = snapshot.open;
    const shown: Public = {
      loading: snapshot.storageStatus === "loading",
      open: open !== null,
      step: open === null ? -1 : open.snapshot.stepIndex,
      found: open !== null && open.snapshot.waymark.status === "found",
      version: notified,
      calls: calls.map(capped),
      subscribeThrew,
      pageListening: inputs.some((signal) => !signal.aborted),
      detaches: detaches.length,
      disconnects: disconnects.length,
      hearing: subscribes > unsubscribes,
      loadInFlight: settle !== undefined,
      thrown,
      events: capped(events),
      handled: capped(handled),
    };
    // So the next play starts on a page no Run is attached to, where the code allows it.
    for (const detach of detaches) thrownBy(detach);
    return shown;
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

type World = Readonly<{ trail: readonly string[]; shown: Public }>;

function differences(world: World, state: ModelState): string[] {
  const found: string[] = [];
  for (const [name, model] of Object.entries(state.shown)) {
    const real: unknown = world.shown[name as keyof Public];
    if (JSON.stringify(real) !== JSON.stringify(model)) found.push(`${name}: the code has ${JSON.stringify(real)}, the model ${JSON.stringify(model)}`);
  }
  return found;
}

const conformance: Conformance<ModelState, World> = {
  start: (state) => ({ trail: [], shown: play(state.wiring, []) }),
  act: (world, action, from) => {
    const trail = [...world.trail, action];
    return { trail, shown: play(from.wiring, trail) };
  },
  differences,
};

// ─── One state graph per pair of listener scripts ──────────────────────────

const pairs = SCRIPTS_1.flatMap((first) => SCRIPTS_2.map((second) => [`listener 1 ${first}, listener 2 ${second}`, first, second] as const));

const configFor = (first: Script, second: Script) =>
  [
    "CONSTANTS",
    "  SyncChoices = {TRUE, FALSE}",
    "  BadChoices = {TRUE, FALSE}",
    '  HandlerChoices = {"default", "handles"}',
    `  Scripts1 = {"${first}"}`,
    `  Scripts2 = {"${second}"}`,
    `  EventScripts = {${EVENT_SCRIPTS.map((script) => `"${script}"`).join(", ")}}`,
    `  Budget = ${BUDGET}`,
    `  Cap = ${CAP}`,
    "SPECIFICATION Spec",
    "",
  ].join("\n");

it.concurrent.for(pairs)("%s: every call the app makes does on the real Run what it does in the model", async ([, first, second]) => {
  const graph = await dumpGraph({ dir: import.meta.dirname, modules: ["Shell.tla"], spec: "Shell.tla", config: configFor(first, second) }, modelState);
  const idle = idleGraph(graph);
  expect(idle.initial.length).toBe(2 * 2 * 2 * EVENT_SCRIPTS.length);
  const checked = conform(idle, conformance);
  expect(checked).toBeGreaterThan(0);
});
