// The rules in cache.test.ts can only fail on code a session runs. A session
// that never gets somewhere passes every rule there without checking it, and
// nothing says so. This plays the same sessions each time and fails unless
// each kind of thing below happened at least once.
//
// A new member of one of these unions does not compile until it is listed
// here, and then fails until a session reaches it: usually a Move to add to
// session.ts, or a part of run.ts its player does not copy yet.
import * as fc from "fast-check";
import { beforeAll, expect, it } from "vitest";
import type { StorageStatus } from "../../src/checklists/types";
import type { DropReason, WaymarkProblem } from "../../src/problems";
import type { Location } from "../../src/run/types";
import type { Effect, Gate, Message, StepState, UserRecord } from "../../src/state";
import type { WalkthroughProgress } from "../../src/walkthrough/types";
import { each, play, sessions, type Asked, type Sent, type Turn } from "./session";

// The same sessions every time, so this fails because the code or the
// sessions changed and never by chance. It takes this many because few
// sessions get far: the `previous` event comes in 7 of them, a lost Waymark
// in 9, a `met` gate in 11.
const SEED = 1;
const SESSIONS = 2000;

/** Things a union does not name. */
type Moment =
  | "a beacon shows"
  | "a command is held while the record loads"
  | "a start request waits"
  | "a walkthrough runs from a checklist's Start"
  | "progress waits for its definition";

const kinds = {
  "kind of Msg": each<Sent>({
    start: true,
    act: true,
    reset: true,
    markDone: true,
    markTodo: true,
    toggle: true,
    skip: true,
    requestStart: true,
    withdrawRequest: true,
    contextChanged: true,
    arrived: true,
    loaded: true,
    heard: true,
    refused: true,
    replaced: true,
    page: true,
    beaconsRead: true,
    attached: true,
    detached: true,
  }),
  // `detached` is only ever made inside update, by the `detached` Msg.
  "message from the page": each<Exclude<Message["type"], "detached">>({ act: true, stepRead: true, look: true, click: true, event: true }),
  effect: each<Effect["_tag"]>({
    scroll: true,
    syncPage: true,
    notifyRun: true,
    notifyChecklist: true,
    save: true,
    saved: true,
    recordUnreadable: true,
    problem: true,
    event: true,
  }),
  event: each<Extract<Effect, { _tag: "event" }>["event"]["type"]>({
    start: true,
    advance: true,
    previous: true,
    collapse: true,
    resume: true,
    reset: true,
    exit: true,
    finish: true,
    interrupt: true,
    taskStarted: true,
    taskComplete: true,
    taskReopened: true,
    taskStopped: true,
    taskSkipped: true,
    taskUnskipped: true,
    checklistComplete: true,
  }),
  // The other three are the shell's: update hands it `recordUnreadable` as an effect, and never sees a storage failure or a callback's error.
  problem: each<Exclude<WaymarkProblem["type"], "storageFailed" | "recordUnreadable" | "callbackThrew">>({
    recordDropped: true,
    waymarkLost: true,
    waymarkMissing: true,
  }),
  "reason an entry is dropped": each<DropReason>({ expired: true, stepsChanged: true, unreadable: true }),
  "answer from the conditions": each<Asked>({ "not asked": true, answered: true, threw: true }),
  "state of storage": each<StorageStatus>({ loading: true, ready: true, error: true, unreadable: true }),
  "status of a walkthrough": each<WalkthroughProgress["status"]>({ running: true, finished: true, exited: true }),
  "stored status of a task": each<UserRecord["taskStatusById"][string]>({ done: true, skipped: true, reopened: true }),
  "gate on the open step": each<Gate["_tag"]>({ locked: true, holding: true, met: true, unlocked: true }),
  "start of the open step": each<StepState["start"]>({ pending: true, resuming: true, started: true }),
  "place of the open step's Waymark": each<Location["status"]>({ absent: true, searching: true, waiting: true, found: true, lost: true, missing: true }),
  moment: each<Moment>({
    "a beacon shows": true,
    "a command is held while the record loads": true,
    "a start request waits": true,
    "a walkthrough runs from a checklist's Start": true,
    "progress waits for its definition": true,
  }),
};

/** An object's own keys, as the type has them. */
function keysOf<T extends object>(of: T): Extract<keyof T, string>[] {
  const keys: Extract<keyof T, string>[] = [];
  for (const key in of) keys.push(key);
  return keys;
}

type Kinds = typeof kinds;
type Kind = keyof Kinds;
/** For each kind, the ones a Turn reached. A kind with no entry here does not compile. */
type Reached = { readonly [K in Kind]: readonly Kinds[K][number][] };

const reachedIn = ({ msg, model, effects, conditions }: Turn): Reached => {
  const problems = effects.flatMap((effect) => (effect._tag === "problem" ? [effect.problem] : []));
  const { openStep } = model.live;
  const moments: Readonly<Record<Moment, boolean>> = {
    "a beacon shows": model.views.run.beacons.value.length > 0,
    "a command is held while the record loads": model.held.length > 0,
    "a start request waits": model.startRequests.waitingToStart.length > 0,
    "a walkthrough runs from a checklist's Start": model.startRequests.startedFromChecklist.size > 0,
    "progress waits for its definition": model.userRecord.unverifiedWalkthroughProgressById.size > 0,
  };
  return {
    "kind of Msg": msg._tag === "request" ? [] : [msg._tag],
    "message from the page": msg._tag === "page" && msg.message.type !== "detached" ? [msg.message.type] : [],
    effect: effects.map((effect) => effect._tag),
    event: effects.flatMap((effect) => (effect._tag === "event" ? [effect.event.type] : [])),
    problem: problems.flatMap(({ type }) => (type === "storageFailed" || type === "recordUnreadable" || type === "callbackThrew" ? [] : [type])),
    "reason an entry is dropped": problems.flatMap((problem) => (problem.type === "recordDropped" ? [problem.reason] : [])),
    "answer from the conditions": [conditions],
    "state of storage": [model.userRecord.storageStatus.type],
    "status of a walkthrough": Object.values(model.userRecord.walkthroughProgressById).map((progress) => progress.status),
    "stored status of a task": Object.values(model.userRecord.taskStatusById),
    "gate on the open step": openStep === undefined ? [] : [openStep.gate._tag],
    "start of the open step": openStep === undefined ? [] : [openStep.start],
    "place of the open step's Waymark": openStep === undefined ? [] : [openStep.waymark.location.status],
    moment: each<Moment>({
      "a beacon shows": true,
      "a command is held while the record loads": true,
      "a start request waits": true,
      "a walkthrough runs from a checklist's Start": true,
      "progress waits for its definition": true,
    }).filter((moment) => moments[moment]),
  };
};

/** For each kind, the ones some session reached. */
const reached = new Map<Kind, Set<string>>();

beforeAll(() => {
  for (const session of fc.sample(sessions, { seed: SEED, numRuns: SESSIONS })) {
    for (const turn of play(session)) {
      const inTurn = reachedIn(turn);
      for (const kind of keysOf(inTurn)) {
        const seen = reached.get(kind) ?? new Set();
        for (const one of inTurn[kind]) seen.add(one);
        reached.set(kind, seen);
      }
    }
  }
  // Under a second. The room is for `pnpm verify`, where the model checker has every core.
}, 120_000);

for (const kind of keysOf(kinds)) {
  // What goes wrong: the code that makes the missing one runs in no session, so no rule in cache.test.ts checks it.
  // One the list does not hold fails too: update made something it was thought not to.
  it(`reaches every ${kind}`, () => {
    expect(reached.get(kind) ?? new Set()).toEqual(new Set<string>(kinds[kind]));
  });
}
