import { describe, expect, it } from "vitest";
import { act, apply, liveWatchers, mount, observe, satisfy } from "./rules";
import type { Message, StepRead } from "./rules";
import { enter } from "./state";
import type { State } from "./state";
import { defineWalkthrough } from "./walkthrough";
import type { Step, Walkthrough } from "./types";

/**
 * Every rule in Waymark, exercised with plain objects: no document, no frame
 * loop, no elements. `act`, `observe` and `mount` are the whole of core's
 * behaviour, so this is what it costs to test it. A Run is a fold over its
 * Messages, so a whole session fits in a list.
 */

/** The driver hands back the same element every frame; so does this. */
const WAYMARK = {} as Element;

/** A Waymark that is present, on screen, with its condition unmet. */
const seen = (over: Partial<StepRead> = {}): StepRead => ({
  element: WAYMARK,
  rect: { x: 0, y: 0, top: 0, right: 10, bottom: 10, left: 0, width: 10, height: 10 },
  inView: true,
  holds: false,
  now: 1000,
  ...over,
});

const frame = (state: State, walkthrough: Walkthrough, read: StepRead) =>
  observe(state, read, walkthrough);

/** The user clicked the Waymark, as the driver reports it. */
const click = (state: State, walkthrough: Walkthrough, now = 1000) =>
  apply(state, { kind: "click", stepGeneration: state.stepGeneration, hit: "waymark", now }, walkthrough);

/** A Run that has had its first look, so its condition is consulted from here on. */
const start = (steps: readonly Step[]) => {
  const walkthrough = defineWalkthrough(steps);
  const state: State = { ...enter(walkthrough, 0), started: true, mounted: true };
  return { walkthrough, state };
};

describe("rules", () => {
  it("hands back the same state when nothing happened", () => {
    const { walkthrough, state } = start([{ waymark: "a" }, {}]);
    const looked = frame(state, walkthrough, seen()).state;

    expect(frame(looked, walkthrough, seen()).state).toBe(looked);
    expect(frame(looked, walkthrough, seen()).events).toEqual([]);
  });

  it("keeps the snapshot when only scratch changed", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);
    const looked = frame(state, walkthrough, seen()).state;
    const holding = frame(looked, walkthrough, seen({ holds: true, now: 1000 }));

    // Arming the clock is scratch; the renderer sees nothing new until it is due.
    expect(holding.state).not.toBe(looked);
    expect(holding.state.heldSince).toBe(1000);
    expect(holding.state.snapshot).toBe(looked.snapshot);
  });

  it("refuses to advance past a gate that is still shut", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: { state: () => false } } },
      {},
    ]);

    const outcome = act(state, "advance", walkthrough);

    expect(outcome.state).toBe(state);
    expect(outcome.events).toEqual([]);
  });

  it("advances once the check has held for the whole delay", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(state, walkthrough, seen({ holds: true, now: 1000 }));
    expect(armed.state.snapshot.stepIndex).toBe(0);
    expect(armed.state.heldSince).toBe(1000);

    const due = frame(armed.state, walkthrough, seen({ holds: true, now: 1050 }));
    expect(due.state.snapshot.stepIndex).toBe(1);
    expect(due.events).toEqual(["advance"]);
  });

  it("disarms the clock if the check stops holding before it is due", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(state, walkthrough, seen({ holds: true, now: 1000 }));
    const dropped = frame(armed.state, walkthrough, seen({ holds: false, now: 1020 }));
    const late = frame(dropped.state, walkthrough, seen({ holds: true, now: 1060 }));

    expect(dropped.state.heldSince).toBeUndefined();
    expect(late.state.snapshot.stepIndex).toBe(0); // the clock started again at 1060
    expect(late.state.heldSince).toBe(1060);
  });

  it("stays satisfied even when the delay outlives the click", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: "click", delayMs: 50 } },
      {},
    ]);

    const clicked = click(state, walkthrough, 1000);
    const waiting = frame(clicked.state, walkthrough, seen({ now: 1020 }));
    const due = frame(waiting.state, walkthrough, seen({ now: 1050 }));

    expect(waiting.state.heldSince).toBe(1000);
    expect(due.state.snapshot.stepIndex).toBe(1);
  });

  it("meets a click condition on the click itself, with no look needed", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, {}]);

    const outcome = click(state, walkthrough);

    expect(outcome.state.snapshot.stepIndex).toBe(1);
    expect(outcome.events).toEqual(["advance"]);
  });

  it("opens the gate without moving when the rule only unlocks", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: "click", then: "unlock" } },
      {},
    ]);

    const outcome = click(state, walkthrough);

    expect(outcome.state.snapshot).toMatchObject({ stepIndex: 0, canAdvance: true });
    expect(outcome.events).toEqual([]);

    const moved = act(outcome.state, "advance", walkthrough);
    expect(moved.state.snapshot.stepIndex).toBe(1);
  });

  it("asks for a scroll once, then stops asking", () => {
    const { walkthrough, state } = start([{ waymark: "a" }]);
    const offScreen = seen({ inView: false });

    const first = frame(state, walkthrough, offScreen);
    const second = frame(first.state, walkthrough, offScreen);

    expect(first.scrollTo).toBe(WAYMARK);
    expect(second.scrollTo).toBeUndefined();
  });

  it("keeps asking on a step that scrolls always", () => {
    const { walkthrough, state } = start([{ waymark: "a", scroll: "always" }]);
    const offScreen = seen({ inView: false });

    const first = frame(state, walkthrough, offScreen);
    const second = frame(first.state, walkthrough, offScreen);

    expect(second.scrollTo).toBe(WAYMARK);
  });

  it("loses a waymark it has seen, but goes on searching for one it has not", () => {
    const { walkthrough, state } = start([{ waymark: "a" }]);
    const gone = seen({ element: null, rect: null });

    const never = frame(state, walkthrough, gone);
    expect(never.state.snapshot).toMatchObject({ waymark: { status: "searching" } });

    const found = frame(state, walkthrough, seen());
    const lost = frame(found.state, walkthrough, gone);
    expect(lost.state.snapshot).toMatchObject({ waymark: { status: "lost" } });
  });

  it("drops every trace of a step when it leaves it", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, { waymark: "b" }]);

    const looked = frame(state, walkthrough, seen({ inView: false }));
    const met = click(looked.state, walkthrough);

    expect(met.state).toMatchObject({
      snapshot: { stepIndex: 1, canAdvance: true, waymark: { status: "searching" } },
      element: null,
      satisfied: false,
      scrolled: false,
      heldSince: undefined,
    });
  });

  it("carries no step scratch once the run is over", () => {
    const { walkthrough, state } = start([{ waymark: "a" }]);
    const looked = frame(state, walkthrough, seen());

    const exited = act(looked.state, "exit", walkthrough);

    expect(exited.state).toMatchObject({
      snapshot: { phase: "exited" },
      element: null,
      scrolled: false,
      heldSince: undefined,
    });
  });

  it("ignores everything but reset once the run is over", () => {
    const { walkthrough } = start([{}, {}]);
    const exited = act(enter(walkthrough, 1), "exit", walkthrough).state;

    expect(act(exited, "advance", walkthrough).state).toBe(exited);
    expect(frame(exited, walkthrough, seen()).state).toBe(exited);
    expect(act(exited, "reset", walkthrough).state.snapshot).toMatchObject({
      phase: "running",
      stepIndex: 0,
    });
  });

  it("increments the step generation on every move, even back to the same step", () => {
    const { walkthrough, state } = start([{}, {}]);
    expect(state.stepGeneration).toBe(0);

    const next = act(state, "advance", walkthrough).state;
    const back = act(next, "previous", walkthrough).state;
    const again = act(back, "reset", walkthrough).state;

    expect([next.stepGeneration, back.stepGeneration, again.stepGeneration]).toEqual([1, 2, 3]);
    expect(again.snapshot).not.toBe(state.snapshot);
    // A refused action is not a move.
    expect(act(again, "previous", walkthrough).state.stepGeneration).toBe(3);
  });

  it("announces finishing as well as the advance that finished it", () => {
    const { walkthrough } = start([{}, {}]);

    const outcome = act(enter(walkthrough, 1), "advance", walkthrough);

    expect(outcome.state.snapshot.phase).toBe("completed");
    expect(outcome.events).toEqual(["advance", "finish"]);
  });

  it("only locates on the look that starts the run, and announces start", () => {
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: { state: () => true } }, {}]);
    const fresh = enter(walkthrough, 0);

    const first = frame(fresh, walkthrough, seen({ holds: true }));

    // The check is not consulted: start comes before anything can move the run.
    expect(first.events).toEqual(["start"]);
    expect(first.state).toMatchObject({
      started: true,
      heldSince: undefined,
      snapshot: { stepIndex: 0, waymark: { status: "found" } },
    });

    const second = frame(first.state, walkthrough, seen({ holds: true }));
    expect(second.state.snapshot.stepIndex).toBe(1);
    expect(second.events).toEqual(["advance"]);
  });

  it("lets nothing move a run that has not had its first look", () => {
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: "click" }, {}]);
    const fresh = { ...enter(walkthrough, 0), mounted: true };

    expect(satisfy(fresh, 1000, walkthrough).state).toBe(fresh);
  });

  it("carries started across steps, so reset does not announce start again", () => {
    const { walkthrough, state } = start([{}, {}]);

    const again = act(state, "reset", walkthrough).state;
    expect(again.started).toBe(true);
    expect(frame(again, walkthrough, seen()).events).toEqual([]);
  });

  it("drops a click or read stamped with a step the run has since left", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, { waymark: "a", advance: "click" }]);
    const stale: Message = { kind: "click", stepGeneration: state.stepGeneration, hit: "waymark", now: 1000 };
    const staleRead: Message = { kind: "stepRead", stepGeneration: state.stepGeneration, stepRead: seen() };

    const moved = apply(state, { kind: "act", action: "advance" }, walkthrough).state;
    expect(moved.snapshot.stepIndex).toBe(0); // the gate is shut; refused

    const clicked = apply(state, stale, walkthrough).state;
    expect(clicked.snapshot.stepIndex).toBe(1);
    expect(apply(clicked, stale, walkthrough).state).toBe(clicked);
    expect(apply(clicked, staleRead, walkthrough).state).toBe(clicked);
  });

  it("reads a click by what it hit and what the step asks for", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: { event: "change" } }, {}]);
    const at = (hit: "waymark" | "ui" | "away"): Message =>
      ({ kind: "click", stepGeneration: state.stepGeneration, hit, now: 1000 });

    // A click on the waymark of an event step is not the event.
    expect(apply(state, at("waymark"), walkthrough).state).toBe(state);
    expect(apply(state, at("ui"), walkthrough).state).toBe(state);
    expect(apply(state, at("away"), walkthrough).state.snapshot).toMatchObject({ collapsed: true });

    const fired: Message = { kind: "event", stepGeneration: state.stepGeneration, now: 1000 };
    expect(apply(state, fired, walkthrough).state.snapshot.stepIndex).toBe(1);
  });

  it("collapses on a click away even if the step has since changed", () => {
    const { walkthrough, state } = start([{}, {}]);
    const away: Message = { kind: "click", stepGeneration: state.stepGeneration, hit: "away", now: 1000 };

    const moved = act(state, "advance", walkthrough).state;
    expect(apply(moved, away, walkthrough).state.snapshot).toMatchObject({ stepIndex: 1, collapsed: true });
  });

  it("drops a state check's clock on unmount, but keeps a satisfied click's", () => {
    const check = start([{ waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } }]);
    const armed = frame(check.state, check.walkthrough, seen({ holds: true })).state;
    expect(armed.heldSince).toBe(1000);

    const gone = mount(armed, false).state;
    expect(gone).toMatchObject({ mounted: false, heldSince: undefined });
    expect(mount(gone, false).state).toBe(gone);

    const clickStep = start([{ waymark: "a", advance: { when: "click", delayMs: 50 } }]);
    const clicked = click(clickStep.state, clickStep.walkthrough).state;
    expect(mount(clicked, false).state.heldSince).toBe(1000);
  });

  it("wants nothing live unless mounted and running", () => {
    const { walkthrough, state } = start([{ waymark: "a" }]);

    expect(liveWatchers({ ...state, mounted: false })).toEqual({ input: false, frame: false, waymarkAria: undefined, waymarkEvents: undefined });
    expect(liveWatchers(act(state, "exit", walkthrough).state)).toEqual({ input: false, frame: false, waymarkAria: undefined, waymarkEvents: undefined });
  });

  it("wants a frame only while the next look could change something", () => {
    const plain = start([{}]).state;
    expect(liveWatchers(plain).frame).toBe(false);

    const waymark = start([{ waymark: "a" }]).state;
    expect(liveWatchers(waymark).frame).toBe(true);

    const check = start([{ advance: { when: { state: () => false }, then: "unlock" } }]);
    expect(liveWatchers(check.state).frame).toBe(true);
    const unlocked = frame(check.state, check.walkthrough, seen({ element: null, rect: null, holds: true })).state;
    expect(unlocked.snapshot).toMatchObject({ canAdvance: true });
    expect(liveWatchers(unlocked).frame).toBe(false);
  });

  it("attaches to a found waymark, listening for events only while the gate is shut", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: { when: { event: "change" }, then: "unlock" } }]);
    expect(liveWatchers(state).waymarkAria).toBeUndefined();
    expect(liveWatchers(state).waymarkEvents).toBeUndefined();

    const found = frame(state, walkthrough, seen()).state;
    expect(liveWatchers(found).waymarkAria).toEqual({ element: WAYMARK, expanded: true });
    expect(liveWatchers(found).waymarkEvents).toEqual({
      element: WAYMARK, events: ["change"], stepGeneration: found.stepGeneration,
    });

    const collapsed = act(found, "collapse", walkthrough).state;
    expect(liveWatchers(collapsed).waymarkAria).toMatchObject({ expanded: false });
    expect(liveWatchers(collapsed).waymarkEvents).toEqual(liveWatchers(found).waymarkEvents);

    const fired: Message = { kind: "event", stepGeneration: found.stepGeneration, now: 1000 };
    const unlocked = apply(found, fired, walkthrough).state;
    expect(liveWatchers(unlocked).waymarkEvents).toBeUndefined();
    expect(liveWatchers(unlocked).waymarkAria).toEqual(liveWatchers(found).waymarkAria);
  });

  it("folds a whole session from its messages", () => {
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: "click" }, {}]);
    const session: Message[] = [
      { kind: "mounted" },
      { kind: "stepRead", stepGeneration: 0, stepRead: seen() },
      { kind: "click", stepGeneration: 0, hit: "waymark", now: 1016 },
      { kind: "act", action: "advance" },
      { kind: "unmounted" },
    ];

    const final = session.reduce(
      (state, message) => apply(state, message, walkthrough).state,
      enter(walkthrough, 0),
    );

    expect(final).toMatchObject({ mounted: false, started: true, snapshot: { phase: "completed", stepIndex: 1 } });
  });
});
