// Random sessions for the real update(): a small app's definitions, every
// kind of thing that can happen to a Run, and the part of run.ts that hands
// definitions over. A session is plain data, so fast-check can print one and
// shrink it. A Move becomes its Msg only when it is played, because some Msgs
// carry what the Run holds by then: the open step's visit, the time.
//
// What it takes from the code is `update`, `initialModel`, and the functions
// an app or the shell calls to make a value: `defineWalkthrough`,
// `defineChecklists`, `groupOf`, `parseRecord` and `viewChecklist`. All else
// is types, so a new kind of Msg does not compile until a session can hold it.
import * as fc from "fast-check";
import { defineChecklists, groupOf } from "../../src/checklists/checklists";
import type { AnyTask, ChecklistDefinition, ChecklistGroup } from "../../src/checklists/types";
import type { ClickHit } from "../../src/run/input";
import type { Action, Rect } from "../../src/run/types";
import { initialModel, update } from "../../src/run/update";
import { viewChecklist } from "../../src/run/views";
import type { Effect, Given, Inputs, Message, Model, Msg, ShowingId, ShownRunState, StepRead, UserRecord, WaymarkRead } from "../../src/state";
import { parseRecord } from "../../src/storage/records";
import type { Read, StoredRecord } from "../../src/storage/records";
import type { Step, Walkthrough, WalkthroughProgress } from "../../src/walkthrough/types";
import { defineWalkthrough } from "../../src/walkthrough/walkthrough";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ─── The app: what it defines ───────────────────────────────────────────────

// The click on `b` must wait out a delay: the only way a step's gate stays `met`.
const tour = defineWalkthrough({ id: "tour", steps: [{ waymark: "a" }, { waymark: "b", advance: { click: true, delayMs: 500 } }, {}] });
const tips = defineWalkthrough({
  id: "tips",
  steps: [
    { waymark: "c", advance: { state: () => true, delayMs: 500 } },
    { selector: ".d", advance: { event: "input", then: "unlock" } },
  ],
  dismiss: "exit",
});
const intro = defineWalkthrough({ id: "intro", steps: [{}], maxAge: MINUTE });

const walkthroughs = { tour, tips, intro } satisfies Record<string, Walkthrough>;
type WalkthroughName = keyof typeof walkthroughs;

// The conditions are never called: each session says what they answer, as `Verdicts`.
const onboarding = defineChecklists({
  tasks: {
    "take-tour": { walkthrough: tour },
    "read-tips": { walkthrough: tips, isComplete: () => false },
    invite: { isComplete: () => false },
    profile: {},
  },
  checklists: { home: ["take-tour", "read-tips", "invite", "profile"], side: ["take-tour", "invite"] },
});
const extras = defineChecklists({ tasks: { welcome: { walkthrough: intro }, shortcuts: { walkthrough: [{ waymark: "e", advance: "click" }] } } });

const checklists = {
  home: onboarding.checklists.home,
  side: onboarding.checklists.side,
  main: extras.checklists.main,
} satisfies Record<string, ChecklistDefinition<AnyTask>>;
type ChecklistName = keyof typeof checklists;

/** Ids a stored record may hold. `ghost` is one no definition answers to. */
const WALKTHROUGH_IDS = ["tour", "tips", "intro", "shortcuts", "ghost"] as const;
const TASK_IDS = ["take-tour", "read-tips", "invite", "profile", "welcome", "shortcuts", "ghost"] as const;
const CONDITIONS = ["read-tips", "invite"] as const;

// ─── A session, as data ─────────────────────────────────────────────────────

/** Where a frame finds a Waymark: not looked for, off the page, or in one of a few places. */
type Sight = "unread" | "gone" | Readonly<{ box: number; inView: boolean }>;
type ReadSketch = Readonly<{ waymark: Sight; holds: boolean | undefined }>;
/** `last` is the step shown before this one, whose late messages must change nothing. */
type Visit = "this" | "last";
type ProgressSketch = Omit<WalkthroughProgress, "changedAt"> & Readonly<{ age: number }>;
type RecordSketch = "nothing" | Readonly<{ walkthroughs: Readonly<Record<string, ProgressSketch>>; tasks: StoredRecord["tasks"] }>;
type TaskRef = Readonly<{ checklist: ChecklistName; task: number }>;
/** The Tasks whose condition holds, or the condition throws. */
type Verdicts = "throws" | readonly string[];

// `detached` is only ever made inside update, by the `detached` Msg.
type Seen =
  | Readonly<{ type: "act"; action: Action }>
  | Readonly<{ type: "stepRead"; visit: Visit; read: ReadSketch }>
  | Readonly<{ type: "look"; visit: Visit; read: ReadSketch | undefined }>
  | Readonly<{ type: "click"; visit: Visit; hit: ClickHit }>
  | Readonly<{ type: "event"; visit: Visit }>;

type Told =
  | Readonly<{ send: "start"; from: WalkthroughName | TaskRef }>
  | Readonly<{ send: "act"; action: Action; walkthrough: WalkthroughName | undefined }>
  | Readonly<{ send: "reset"; walkthrough: WalkthroughName }>
  | Readonly<{ send: "markDone"; at: TaskRef }>
  | Readonly<{ send: "markTodo"; at: TaskRef }>
  | Readonly<{ send: "toggle"; at: TaskRef }>
  | Readonly<{ send: "skip"; at: TaskRef; fromPopover: boolean }>
  | Readonly<{ send: "requestStart"; walkthrough: WalkthroughName }>
  | Readonly<{ send: "withdrawRequest"; walkthrough: WalkthroughName }>
  | Readonly<{ send: "contextChanged"; verdicts: Verdicts }>
  | Readonly<{ send: "arrived"; join: ChecklistName | undefined }>
  | Readonly<{ send: "loaded"; read: RecordSketch | "unreadable" | "failed" }>
  | Readonly<{ send: "heard"; read: RecordSketch | "unreadable" }>
  | Readonly<{ send: "refused" }>
  | Readonly<{ send: "replaced"; read: RecordSketch }>
  | Readonly<{ send: "page"; seen: Seen }>
  | Readonly<{ send: "beaconsRead"; reads: readonly (readonly [string, Sight])[] }>
  | Readonly<{ send: "attached" }>
  | Readonly<{ send: "detached" }>
  /** The app reads a checklist without mounting it: no Msg, but the Run must show it from then on. */
  | Readonly<{ send: "nothing"; ask: ChecklistName }>;

/** `after` is how long since the Move before it, in ms. */
export type Move = Readonly<{ after: number; told: Told }>;

/** `loads`: the Run has storage, so it starts loading. */
export type Session = Readonly<{ loads: boolean; moves: readonly Move[] }>;

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Every member of a union of strings. A member missing from `all`, or one too many, does not compile. */
export function each<T extends string>(all: Readonly<Record<T, true>>): T[] {
  const members: T[] = [];
  for (const member in all) members.push(member);
  return members;
}

// Weighted towards the two that take a session somewhere new: further through a walkthrough, or to a beacon.
const action = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Action>("advance") },
  { weight: 2, arbitrary: fc.constant<Action>("collapse") },
  { weight: 5, arbitrary: fc.constantFrom(...each<Action>({ advance: true, previous: true, collapse: true, resume: true, reset: true, exit: true })) },
);
const hit = fc.constantFrom(...each<ClickHit>({ waymark: true, ui: true, away: true }));
const status = fc.constantFrom(...each<WalkthroughProgress["status"]>({ running: true, finished: true, exited: true }));
const stored = fc.constantFrom(...each<StoredRecord["tasks"][string]>({ done: true, skipped: true, reopened: true }));
const visit = fc.constantFrom(...each<Visit>({ this: true, last: true }));
const walkthroughName = fc.constantFrom(...each<WalkthroughName>({ tour: true, tips: true, intro: true }));
const checklistName = fc.constantFrom(...each<ChecklistName>({ home: true, side: true, main: true }));

const taskRef: fc.Arbitrary<TaskRef> = fc.record({ checklist: checklistName, task: fc.nat({ max: 3 }) });
const sight: fc.Arbitrary<Sight> = fc.oneof(
  fc.constant("unread"),
  fc.constant("gone"),
  fc.record({ box: fc.nat({ max: 2 }), inView: fc.boolean() }),
);
const read: fc.Arbitrary<ReadSketch> = fc.record({ waymark: sight, holds: fc.option(fc.boolean(), { nil: undefined }) });

// Steps and counts that do not fit each other or the definition are meant: storage holds what an older release wrote.
const progress: fc.Arbitrary<ProgressSketch> = fc.record({
  status,
  step: fc.nat({ max: 3 }),
  stepCount: fc.integer({ min: 1, max: 4 }),
  collapsed: fc.boolean(),
  age: fc.constantFrom(0, 1000, 2 * MINUTE, 2 * DAY),
});
const record: fc.Arbitrary<RecordSketch> = fc.oneof(
  { weight: 1, arbitrary: fc.constant("nothing") },
  {
    weight: 4,
    arbitrary: fc.record({
      walkthroughs: fc.dictionary(fc.constantFrom(...WALKTHROUGH_IDS), progress, { maxKeys: 3 }),
      tasks: fc.dictionary(fc.constantFrom(...TASK_IDS), stored, { maxKeys: 3 }),
    }),
  },
);
const unreadable = fc.constant("unreadable");
const verdicts: fc.Arbitrary<Verdicts> = fc.oneof(
  { weight: 1, arbitrary: fc.constant("throws") },
  { weight: 6, arbitrary: fc.subarray([...CONDITIONS]) },
);

const seen: fc.Arbitrary<Seen> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ type: fc.constant("act"), action }) },
  { weight: 6, arbitrary: fc.record({ type: fc.constant("stepRead"), visit, read }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constant("look"), visit, read: fc.option(read, { nil: undefined }) }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant("click"), visit, hit }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("event"), visit }) },
);

// `request` is the part of `requestStart` that update holds while loading; the shell never sends it.
export type Sent = Exclude<Msg["_tag"], "request">;

/** One entry for each kind of Msg the shell sends. */
const sent: { readonly [Tag in Sent]: fc.WeightedArbitrary<Extract<Told, { send: Tag }>> } = {
  start: { weight: 6, arbitrary: fc.record({ send: fc.constant("start"), from: fc.oneof(walkthroughName, taskRef) }) },
  act: { weight: 5, arbitrary: fc.record({ send: fc.constant("act"), action, walkthrough: fc.option(walkthroughName, { nil: undefined }) }) },
  reset: { weight: 1, arbitrary: fc.record({ send: fc.constant("reset"), walkthrough: walkthroughName }) },
  markDone: { weight: 2, arbitrary: fc.record({ send: fc.constant("markDone"), at: taskRef }) },
  markTodo: { weight: 2, arbitrary: fc.record({ send: fc.constant("markTodo"), at: taskRef }) },
  toggle: { weight: 2, arbitrary: fc.record({ send: fc.constant("toggle"), at: taskRef }) },
  skip: { weight: 2, arbitrary: fc.record({ send: fc.constant("skip"), at: taskRef, fromPopover: fc.boolean() }) },
  requestStart: { weight: 2, arbitrary: fc.record({ send: fc.constant("requestStart"), walkthrough: walkthroughName }) },
  withdrawRequest: { weight: 1, arbitrary: fc.record({ send: fc.constant("withdrawRequest"), walkthrough: walkthroughName }) },
  contextChanged: { weight: 2, arbitrary: fc.record({ send: fc.constant("contextChanged"), verdicts }) },
  arrived: { weight: 3, arbitrary: fc.record({ send: fc.constant("arrived"), join: fc.option(checklistName, { nil: undefined }) }) },
  loaded: { weight: 4, arbitrary: fc.record({ send: fc.constant("loaded"), read: fc.oneof(record, record, unreadable, fc.constant("failed")) }) },
  heard: { weight: 4, arbitrary: fc.record({ send: fc.constant("heard"), read: fc.oneof(record, record, record, unreadable) }) },
  refused: { weight: 1, arbitrary: fc.constant({ send: "refused" }) },
  replaced: { weight: 1, arbitrary: fc.record({ send: fc.constant("replaced"), read: record }) },
  page: { weight: 30, arbitrary: fc.record({ send: fc.constant("page"), seen }) },
  beaconsRead: {
    weight: 6,
    arbitrary: fc.record({ send: fc.constant("beaconsRead"), reads: fc.array(fc.tuple(fc.constantFrom(...WALKTHROUGH_IDS), sight), { maxLength: 3 }) }),
  },
  attached: { weight: 4, arbitrary: fc.constant({ send: "attached" }) },
  detached: { weight: 1, arbitrary: fc.constant({ send: "detached" }) },
};

const told: fc.Arbitrary<Told> = fc.oneof(...Object.values(sent), {
  weight: 2,
  arbitrary: fc.record({ send: fc.constant("nothing"), ask: checklistName }),
});

// Mostly the same moment or a few seconds on; now and then long enough for progress to go stale.
const after = fc.oneof(
  { weight: 8, arbitrary: fc.constant(0) },
  { weight: 8, arbitrary: fc.integer({ min: 1, max: 4000 }) },
  { weight: 1, arbitrary: fc.constantFrom(2 * MINUTE, 2 * DAY) },
);

export const sessions: fc.Arbitrary<Session> = fc.record({
  loads: fc.boolean(),
  // `size: "max"` so a session is as likely to be long as short: most of what a Run does needs several Moves to reach.
  moves: fc.array(fc.record({ after, told }), { maxLength: 80, size: "max" }),
});

// ─── Playing one ────────────────────────────────────────────────────────────

/** What became of the Tasks' conditions in one call of update(). */
export type Asked = "not asked" | "answered" | "threw";

/** One call of update(): the Msg, the model either side of it, and what the app had handed over by then. */
export type Turn = Readonly<{ msg: Msg; before: Model; model: Model; given: Given; effects: readonly Effect[]; conditions: Asked }>;

/** What the views are worked out from. */
export const shownOf = (model: Model, given: Given): ShownRunState => ({
  walkthroughsAndChecklistsInUse: given.walkthroughsAndChecklistsInUse,
  userRecord: model.userRecord,
  live: model.live,
});

const userRecordAt = (type: "loading" | "ready"): UserRecord => ({
  walkthroughProgressById: {},
  taskStatusById: {},
  unverifiedWalkthroughProgressById: new Map(),
  storageStatus: { type },
});

// A new object each time, as `getBoundingClientRect` gives one.
const rectOf = (box: number): Rect => {
  const left = box * 40;
  return { x: left, y: 10, top: 10, right: left + 30, bottom: 40, left, width: 30, height: 30 };
};

const hasWaymark = (step: Step | undefined): boolean => step?.waymark !== undefined || step?.selector !== undefined;
const hasCheck = (step: Step | undefined): boolean => typeof step?.advance === "object" && "state" in step.advance;

const taskAt = ({ checklist, task }: TaskRef): string => {
  const { tasks } = checklists[checklist];
  const at = tasks[task % tasks.length];
  if (at === undefined) throw new Error(`Checklist "${checklist}" has no tasks.`);
  return at.id;
};

/** Plays a session as run.ts would, and gives each call of update() as it is made. */
export function* play(session: Session): Generator<Turn> {
  const elements = [document.createElement("div"), document.createElement("div"), document.createElement("div")];
  let given: Given = {
    walkthroughsAndChecklistsInUse: { walkthroughsById: new Map(), checklistDefinitions: [] },
    checklistContext: undefined,
    checklistsAsked: new Map(),
  };
  let model = initialModel(given, userRecordAt(session.loads ? "loading" : "ready"));
  let now = 1_700_000_000_000;
  let attached = false;
  let holding: Verdicts = [];
  let lastVisit: ShowingId | undefined;
  /** The app holds `replace` once a `recordUnreadable` problem has handed it over. */
  let canReplace = false;
  let turns: Turn[] = [];
  let conditions: Asked = "not asked";

  const inputs = (): Inputs => ({
    now,
    verdicts: (tasks) => {
      conditions = holding === "throws" ? "threw" : "answered";
      return holding === "throws" ? undefined : new Map(tasks.map((task) => [task.id, task.isComplete !== undefined && holding.includes(task.id)]));
    },
  });

  const send = (msg: Msg) => {
    const before = model;
    conditions = "not asked";
    const next = update(model, given, msg, inputs());
    model = next.model;
    const was = before.live.openStep?.showingId;
    if (was !== undefined && was !== model.live.openStep?.showingId) lastVisit = was;
    if (next.effects.some((effect) => effect._tag === "recordUnreadable")) canReplace = true;
    turns.push({ msg, before, model, given, effects: next.effects, conditions });
  };

  // ── run.ts's part: `given` is written by the call that hands something over, never by update ──

  const take = (walkthrough: Walkthrough): Walkthrough => {
    const inUse = given.walkthroughsAndChecklistsInUse;
    const known = inUse.walkthroughsById.get(walkthrough.id);
    if (known !== undefined) return known;
    given = { ...given, walkthroughsAndChecklistsInUse: { ...inUse, walkthroughsById: new Map(inUse.walkthroughsById).set(walkthrough.id, walkthrough) } };
    return walkthrough;
  };

  const ask = (definition: ChecklistDefinition<AnyTask>) => {
    if (given.checklistsAsked.has(definition)) return;
    const group = groupOf(definition);
    const first = viewChecklist(definition, group, undefined, shownOf(model, given));
    given = { ...given, checklistsAsked: new Map(given.checklistsAsked).set(definition, { group, first }) };
  };

  const join = (group: ChecklistGroup) => {
    if (given.walkthroughsAndChecklistsInUse.checklistDefinitions.includes(group)) return;
    for (const task of group.tasks) if (task.walkthrough !== undefined) take(task.walkthrough);
    const inUse = given.walkthroughsAndChecklistsInUse;
    given = { ...given, walkthroughsAndChecklistsInUse: { ...inUse, checklistDefinitions: [...inUse.checklistDefinitions, group] } };
    for (const definition of group.checklists) ask(definition);
    send({ _tag: "arrived" });
  };

  /** A checklist's button: its group reaches the Run first. */
  const mounted = ({ checklist }: TaskRef): ChecklistGroup => {
    const group = groupOf(checklists[checklist]);
    join(group);
    return group;
  };

  // ── What storage and the page give ──

  const recordOf = (sketch: RecordSketch): StoredRecord | null => {
    if (sketch === "nothing") return null;
    const entries = Object.entries(sketch.walkthroughs).map(([id, { age, ...at }]) => [id, { ...at, changedAt: now - age }] as const);
    return { version: 1, walkthroughs: Object.fromEntries(entries), tasks: sketch.tasks };
  };

  const parsed = (sketch: RecordSketch | "unreadable") => parseRecord(sketch === "unreadable" ? { version: 99 } : recordOf(sketch));

  const readable = (sketch: RecordSketch): Read | null => {
    const result = parsed(sketch);
    if (!result.ok) throw result.error;
    return result.value;
  };

  const refusal = () => {
    const result = parsed("unreadable");
    if (result.ok) throw new Error("A record from version 99 was read.");
    return result.error;
  };

  const stepOpen = (): Step | undefined => {
    const stepState = model.live.openStep;
    return stepState === undefined ? undefined : given.walkthroughsAndChecklistsInUse.walkthroughsById.get(stepState.walkthrough)?.steps[stepState.waymark.step];
  };

  const waymarkRead = (seenAt: Exclude<Sight, "unread">): WaymarkRead =>
    seenAt === "gone" ? { element: null, rect: null, inView: false } : { element: elements[seenAt.box] ?? null, rect: rectOf(seenAt.box), inView: seenAt.inView };

  // As page.ts reads a step: its Waymark only if it has one, its check only if it has one or its delay is running.
  const stepRead = (sketch: ReadSketch): StepRead => {
    const step = stepOpen();
    const checks = hasCheck(step) || model.live.openStep?.gate._tag === "met";
    return {
      now,
      ...(hasWaymark(step) && sketch.waymark !== "unread" ? { waymark: waymarkRead(sketch.waymark) } : {}),
      ...(checks && sketch.holds !== undefined ? { advance: { holds: sketch.holds } } : {}),
    };
  };

  const fromPage = (saw: Seen): Message | undefined => {
    if (saw.type === "act") return saw;
    const showingId = saw.visit === "this" ? model.live.openStep?.showingId : lastVisit;
    if (showingId === undefined) return undefined;
    switch (saw.type) {
      case "stepRead":
        return { type: "stepRead", showingId, read: stepRead(saw.read) };
      case "look":
        return { type: "look", showingId, read: saw.read === undefined ? undefined : stepRead(saw.read) };
      case "click":
        return { type: "click", showingId, hit: saw.hit, now };
      case "event":
        return { type: "event", showingId, now };
    }
  };

  const happen = (move: Told) => {
    const loading = model.userRecord.storageStatus.type === "loading";
    switch (move.send) {
      case "start": {
        if (typeof move.from === "string") return send({ _tag: "start", walkthrough: take(walkthroughs[move.from]), fromChecklist: undefined });
        const id = taskAt(move.from);
        const walkthrough = mounted(move.from).tasks.find((task) => task.id === id)?.walkthrough;
        if (walkthrough !== undefined) send({ _tag: "start", walkthrough: take(walkthrough), fromChecklist: move.from.checklist });
        return;
      }
      case "act": {
        if (move.walkthrough !== undefined) return send({ _tag: "act", action: move.action, walkthrough: take(walkthroughs[move.walkthrough]) });
        if (loading) return send({ _tag: "act", action: move.action, walkthrough: undefined });
        // The one open at the call, as the caller saw it.
        const open = model.views.run.snapshot.value.open?.walkthrough;
        if (open !== undefined) send({ _tag: "act", action: move.action, walkthrough: open });
        return;
      }
      case "reset":
        return send({ _tag: "reset", walkthrough: take(walkthroughs[move.walkthrough]) });
      case "markDone":
        mounted(move.at);
        return send({ _tag: "markDone", task: taskAt(move.at) });
      case "markTodo":
      case "toggle":
        mounted(move.at);
        return send({ _tag: move.send, task: taskAt(move.at), checklist: move.at.checklist });
      case "skip":
        if (!move.fromPopover) mounted(move.at);
        return send({ _tag: "skip", task: taskAt(move.at), checklist: move.fromPopover ? undefined : move.at.checklist });
      case "requestStart":
        return send({ _tag: "requestStart", walkthrough: take(walkthroughs[move.walkthrough]) });
      case "withdrawRequest":
        return send({ _tag: "withdrawRequest", walkthrough: move.walkthrough });
      case "contextChanged":
        holding = move.verdicts;
        // As `setContext` does: a context that is `undefined` asks no condition, so each one here is a new object.
        given = { ...given, checklistContext: {} };
        return send({ _tag: "contextChanged" });
      case "arrived": {
        const joined = turns.length;
        if (move.join !== undefined) join(groupOf(checklists[move.join]));
        // `join` sends its own; the link sends one after a record it heard.
        if (turns.length === joined) send({ _tag: "arrived" });
        return;
      }
      // The link loads once, and hears nothing until it has.
      case "loaded":
        if (loading) send({ _tag: "loaded", read: move.read === "failed" ? "failed" : parsed(move.read) });
        return;
      case "heard":
        if (session.loads && !loading) send({ _tag: "heard", read: parsed(move.read) });
        return;
      case "refused":
        if (session.loads && !loading) send({ _tag: "refused", error: refusal() });
        return;
      case "replaced":
        if (canReplace) send({ _tag: "replaced", read: readable(move.read) });
        return;
      // The page sends only while attached.
      case "page": {
        const message = attached ? fromPage(move.seen) : undefined;
        if (message !== undefined) send({ _tag: "page", message });
        return;
      }
      // As page.ts looks at beacons: while none is open, and only at the walkthroughs that may show one.
      case "beaconsRead": {
        if (!attached || model.live.openStep !== undefined) return;
        const reads = new Map<string, WaymarkRead>();
        for (const [walkthrough, walkthroughProgress] of model.views.run.candidates.value) {
          const seenAt = move.reads.find(([id]) => id === walkthrough.id)?.[1];
          if (seenAt !== undefined && seenAt !== "unread" && hasWaymark(walkthrough.steps[walkthroughProgress.step])) reads.set(walkthrough.id, waymarkRead(seenAt));
        }
        return send({ _tag: "beaconsRead", reads, now });
      }
      case "attached":
        attached = true;
        return send({ _tag: "attached" });
      case "detached":
        attached = false;
        return send({ _tag: "detached" });
      case "nothing":
        return ask(checklists[move.ask]);
    }
  };

  for (const move of session.moves) {
    now += move.after;
    turns = [];
    happen(move.told);
    yield* turns;
  }
}
