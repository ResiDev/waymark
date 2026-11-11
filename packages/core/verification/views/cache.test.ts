// The Run keeps every snapshot it hands out, and works one out again only
// when something it reads has moved. That is a second copy of what the facts
// already say, and a second copy can fall behind. These play random sessions
// through the real update() and check, after every Msg, that it has not.
//
// A failure prints the shortest session fast-check could find that still
// breaks the rule, and a seed and path. To play that one session again, pass
// them to the `fc.assert` that failed, beside `numRuns`: `{ seed, path }`.
//
// Each rule plays 100 sessions under `pnpm test` and 1000 under `pnpm verify`.
// `pnpm test:fastcheck 5000` plays as many as it is given.
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { viewChecklist, viewRun } from "../../src/run/views";
import type { RunViews } from "../../src/state";
import { play, sessions, shownOf, type Turn } from "./session";

const numRuns = Number(process.env["FASTCHECK_RUNS"] ?? 100);
// A session takes about a millisecond. The room is for a busy machine.
const timeout = Math.max(5000, numRuns * 30);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;

/** The same all the way down. A definition, a step's function or anything else that is not plain data must be the same one. */
function sameContent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isRecord(a) || !isRecord(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameContent(a[key], b[key]));
}

/** A new object holding the same things. */
const renewed = (was: unknown, now: unknown): boolean => now !== was && sameContent(was, now);

/** Told once, with `now`, if it is a new object; not told if it is not. */
const toldRightly = (told: readonly unknown[], was: unknown, now: unknown): boolean =>
  now === was ? told.length === 0 : told.length === 1 && told[0] === now;

/** What each of the Run's views holds. A view added to `RunViews` and not listed here does not compile. */
const valuesOf = ({ candidates, open, beacons, snapshot }: RunViews) =>
  ({ candidates, open, beacons, snapshot }) satisfies Record<Exclude<keyof RunViews, "from">, unknown>;

/** Each checklist the app has asked for, as it showed before the Msg and shows after it. */
function* checklistsOf({ before, model, given }: Turn) {
  for (const [definition, { group, first }] of given.checklistsAsked) {
    const was = before.views.checklists.get(definition) ?? first;
    const now = model.views.checklists.get(definition) ?? first;
    yield { definition, group, was, now };
  }
}

// What goes wrong: a view that reads something `RunViews.from` does not list, or
// hands back its last value when it should not, shows the user a walkthrough,
// a beacon or a tick that is no longer so, until some unrelated change
// happens to work it out again.
it("holds what would be worked out from nothing, after every Msg", { timeout }, () => {
  fc.assert(
    fc.property(sessions, (session) => {
      for (const turn of play(session)) {
        const state = shownOf(turn.model, turn.given);
        expect(valuesOf(turn.model.views.run)).toEqual(valuesOf(viewRun(undefined, state)));
        for (const { definition, group, now } of checklistsOf(turn)) {
          expect(now, `checklist "${definition.name}"`).toEqual(viewChecklist(definition, group, undefined, state));
        }
      }
    }),
    { numRuns },
  );
});

/** The two Msgs after which the Run hands back a new snapshot holding the same things. bugs.test.ts shows each. */
const brokenToday = ({ msg, effects }: Turn): boolean =>
  msg._tag === "replaced" || (msg._tag === "heard" && effects.some((effect) => effect._tag === "problem" && effect.problem.type === "recordDropped"));

// What goes wrong: React compares snapshots by identity, so a new object
// holding the same things renders every component that reads it again, and on
// the frame loop that is sixty times a second. RunSnapshot, a walkthrough's
// Snapshot and ChecklistSnapshot each promise "a new object only when
// something in it changed".
it("hands back the same snapshot until something in it changed", { timeout }, () => {
  fc.assert(
    fc.property(sessions, (session) => {
      for (const turn of play(session)) {
        if (brokenToday(turn)) continue;
        const was = turn.before.views.run.snapshot;
        const now = turn.model.views.run.snapshot;
        expect(renewed(was, now), "the Run's snapshot is a new object holding the same things").toBe(false);
        const sameWalkthrough = was.open?.walkthrough === now.open?.walkthrough;
        expect(sameWalkthrough && renewed(was.open?.snapshot, now.open?.snapshot), "the open walkthrough's snapshot is a new object holding the same things").toBe(false);
        for (const shown of checklistsOf(turn)) {
          expect(renewed(shown.was, shown.now), `checklist "${shown.definition.name}"'s snapshot is a new object holding the same things`).toBe(false);
        }
      }
    }),
    { numRuns },
  );
});

// What goes wrong: a listener not told keeps showing the old snapshot; one
// told with a snapshot that is not the current one shows something
// `getSnapshot` never returns.
it("tells a listener once when its snapshot is a new object, with that object, and not otherwise", { timeout }, () => {
  fc.assert(
    fc.property(sessions, (session) => {
      for (const turn of play(session)) {
        const toldRun = turn.effects.flatMap((effect) => (effect._tag === "notifyRun" ? [effect.snapshot] : []));
        expect(toldRightly(toldRun, turn.before.views.run.snapshot, turn.model.views.run.snapshot), "the Run's listeners").toBe(true);
        for (const shown of checklistsOf(turn)) {
          const told = turn.effects.flatMap((effect) => (effect._tag === "notifyChecklist" && effect.checklist === shown.definition ? [effect.snapshot] : []));
          expect(toldRightly(told, shown.was, shown.now), `checklist "${shown.definition.name}"'s listeners`).toBe(true);
        }
      }
    }),
    { numRuns },
  );
});
