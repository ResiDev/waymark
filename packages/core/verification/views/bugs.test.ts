// Each break of a rule in cache.test.ts, as the shortest session that shows
// it. Each pair is one `it` that passes, saying nothing in the snapshot
// changed, and one `it.fails`, which passes while the Run hands back a new
// object anyway and fails once it is fixed. When one is fixed, take its line
// out of "hands back the same snapshot" in cache.test.ts, and delete it here.
import { describe, expect, it } from "vitest";
import { play, type Session } from "./session";

/** The Run's snapshot either side of the session's last Msg. */
function atLastMsg(session: Session) {
  const turn = [...play(session)].at(-1);
  if (turn === undefined) throw new Error("The session sent nothing.");
  return { was: turn.before.views.run.snapshot, now: turn.model.views.run.snapshot };
}

// The app holds `replace` from a `recordUnreadable` problem and calls it a
// second time: a handler that runs twice, or a retry. The second call has
// nothing to add, yet every listener is told and every component reading the
// Run renders again.
describe("a replace that brings nothing new", () => {
  const record = { walkthroughs: {}, tasks: {} };
  const { was, now } = atLastMsg({
    loads: true,
    moves: [
      { after: 0, told: { send: "loaded", read: "unreadable" } },
      { after: 0, told: { send: "replaced", read: record } },
      { after: 0, told: { send: "replaced", read: record } },
    ],
  });

  it("changes nothing in the Run's snapshot", () => {
    expect(now).toEqual(was);
  });

  it.fails("hands back the same snapshot", () => {
    expect(now).toBe(was);
  });
});

// Another tab, on an older release, saves progress in a walkthrough that has
// since lost a step. This tab drops the entry, rightly, and holds what it held
// before. But it hands out a new snapshot each time that tab saves, so the
// Run's listeners are told and its components render again for nothing.
describe("an entry heard from another tab and dropped because its steps no longer fit", () => {
  const { was, now } = atLastMsg({
    loads: true,
    moves: [
      { after: 0, told: { send: "loaded", read: "nothing" } },
      { after: 0, told: { send: "arrived", join: "main" } },
      {
        after: 0,
        told: { send: "heard", read: { walkthroughs: { shortcuts: { status: "running", step: 0, stepCount: 2, collapsed: false, age: 0 } }, tasks: {} } },
      },
    ],
  });

  it("changes nothing in the Run's snapshot", () => {
    expect(now).toEqual(was);
  });

  it.fails("hands back the same snapshot", () => {
    expect(now).toBe(was);
  });
});
