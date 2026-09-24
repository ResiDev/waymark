import { describe, expect, it } from "vitest";
import { act, apply, liveWatchers, mount, observe, observeAdvance, observeWaymark, satisfy } from "./rules";
import type { AdvanceRead, Message, WaymarkRead } from "./rules";
import { enter } from "./state";
import type { State } from "./state";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { Step, Walkthrough } from "../walkthrough/types";

/** Pure rules exercised independently with plain observations and queued messages. */

/** The driver hands back the same element every frame; so does this. */
const WAYMARK = {} as Element;

/** A Waymark that is present, on screen, with its condition unmet. */
const seen = (over: Partial<WaymarkRead> = {}): WaymarkRead => ({
  element: WAYMARK,
  rect: { x: 0, y: 0, top: 0, right: 10, bottom: 10, left: 0, width: 10, height: 10 },
  inView: true,
  ...over,
});

const checked = (over: Partial<AdvanceRead> = {}): AdvanceRead => ({
  holds: false,
  now: 1000,
  ...over,
});

/** The user clicked the Waymark, as the driver reports it. */
const click = (state: State, walkthrough: Walkthrough, now = 1000) =>
  apply(state, { kind: "click", stepGeneration: state.stepGeneration, hit: "waymark", now }, walkthrough);

/** A mounted run whose startup has already been announced. */
const start = (steps: readonly Step[]) => {
  const walkthrough = defineWalkthrough(steps);
  const state: State = { ...enter(walkthrough, 0), started: true, mounted: true };
  return { walkthrough, state };
};

describe("rules", () => {
  it("updates waymark geometry without resetting an advance condition's delay", () => {
    const { state, walkthrough } = start([
      { waymark: "a", advance: { state: () => true, delayMs: 50 } },
    ]);
    const holding = observeAdvance(state, checked({ holds: true }), walkthrough).state;
    const found = observeWaymark(holding, seen()).state;
    const lost = observeWaymark(found, seen({ element: null, rect: null })).state;
    expect(lost.heldSince).toBe(1000);
    expect(lost.snapshot).toMatchObject({ canAdvance: false, waymark: { status: "lost" } });
  });

  it("unlocks from an advance read without changing the waymark or requesting a scroll", () => {
    const { state, walkthrough } = start([
      { waymark: "a", advance: { state: () => true, then: "unlock" } },
    ]);
    const found = observeWaymark(state, seen()).state;
    const unlocked = observeAdvance(found, checked({ holds: true }), walkthrough);
    expect(unlocked.state.snapshot).toMatchObject({ canAdvance: true });
    expect(unlocked.state.snapshot.phase === "running" && unlocked.state.snapshot.waymark)
      .toBe(found.snapshot.phase === "running" && found.snapshot.waymark);
    expect(unlocked.state.element).toBe(WAYMARK);
    expect(unlocked.scrollTo).toBeUndefined();
  });

  it("rejects a read from an earlier visit to the same step", () => {
    const { state, walkthrough } = start([{ waymark: "a", advance: { state: () => true } }, {}]);
    const reset = act(state, "reset", walkthrough).state;
    const read: Message = {
      kind: "stepRead",
      stepGeneration: state.stepGeneration,
      stepRead: { waymark: seen(), advance: checked({ holds: true }) },
    };
    expect(apply(reset, read, walkthrough).state).toBe(reset);
  });

  it("applies the measurement first, then the check on one look", () => {
    const { state, walkthrough } = start([
      { waymark: "a", advance: { state: () => true, delayMs: 50 } },
      { waymark: "b" },
    ]);
    const offScreen = seen({ inView: false });

    // Arming the clock keeps the scroll the measurement asked for.
    const armed = observe(state, { waymark: offScreen, advance: checked({ holds: true }) }, walkthrough);
    expect(armed.scrollTo).toBe(WAYMARK);
    expect(armed.state).toMatchObject({ heldSince: 1000, snapshot: { waymark: { status: "found" } } });

    // Leaving the step drops it: no scrolling to a waymark just left.
    const gone = observe(armed.state, { waymark: offScreen, advance: checked({ holds: true, now: 1050 }) }, walkthrough);
    expect(gone.state.snapshot.stepIndex).toBe(1);
    expect(gone.scrollTo).toBeUndefined();

    // Either half may be missing.
    expect(observe(state, { waymark: seen() }, walkthrough).state.element).toBe(WAYMARK);
    expect(observe(state, { advance: checked({ holds: true }) }, walkthrough).state.heldSince).toBe(1000);
    expect(observe(state, {}, walkthrough).state).toBe(state);
  });

  it("hands back the same state when nothing happened", () => {
    const { state } = start([{ waymark: "a" }, {}]);
    const looked = observeWaymark(state, seen()).state;

    expect(observeWaymark(looked, seen()).state).toBe(looked);
    expect(observeWaymark(looked, seen()).events).toEqual([]);
  });

  it("keeps the snapshot when only scratch changed", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { state: () => true, delayMs: 50 } },
      {},
    ]);
    const looked = observeWaymark(state, seen()).state;
    const holding = observeAdvance(looked, checked({ holds: true, now: 1000 }), walkthrough);

    // Arming the clock is scratch; the renderer sees nothing new until it is due.
    expect(holding.state).not.toBe(looked);
    expect(holding.state.heldSince).toBe(1000);
    expect(holding.state.snapshot).toBe(looked.snapshot);
  });

  it("refuses to advance past a gate that is still shut", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { state: () => false } },
      {},
    ]);

    const outcome = act(state, "advance", walkthrough);

    expect(outcome.state).toBe(state);
    expect(outcome.events).toEqual([]);
  });

  it("advances once the check has held for the whole delay", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { state: () => true, delayMs: 50 } },
      {},
    ]);

    const armed = observeAdvance(state, checked({ holds: true, now: 1000 }), walkthrough);
    expect(armed.state.snapshot.stepIndex).toBe(0);
    expect(armed.state.heldSince).toBe(1000);

    const due = observeAdvance(armed.state, checked({ holds: true, now: 1050 }), walkthrough);
    expect(due.state.snapshot.stepIndex).toBe(1);
    expect(due.events).toEqual(["advance"]);
  });

  it("disarms the clock if the check stops holding before it is due", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { state: () => true, delayMs: 50 } },
      {},
    ]);

    const armed = observeAdvance(state, checked({ holds: true, now: 1000 }), walkthrough);
    const dropped = observeAdvance(armed.state, checked({ holds: false, now: 1020 }), walkthrough);
    const late = observeAdvance(dropped.state, checked({ holds: true, now: 1060 }), walkthrough);

    expect(dropped.state.heldSince).toBeUndefined();
    expect(late.state.snapshot.stepIndex).toBe(0); // the clock started again at 1060
    expect(late.state.heldSince).toBe(1060);
  });

  it("stays satisfied even when the delay outlives the click", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { click: true, delayMs: 50 } },
      {},
    ]);

    const clicked = click(state, walkthrough, 1000);
    const waiting = observeAdvance(clicked.state, checked({ now: 1020 }), walkthrough);
    const due = observeAdvance(waiting.state, checked({ now: 1050 }), walkthrough);

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
      { waymark: "a", advance: { click: true, then: "unlock" } },
      {},
    ]);

    const outcome = click(state, walkthrough);

    expect(outcome.state.snapshot).toMatchObject({ stepIndex: 0, canAdvance: true });
    expect(outcome.events).toEqual([]);

    const moved = act(outcome.state, "advance", walkthrough);
    expect(moved.state.snapshot.stepIndex).toBe(1);
  });

  it("asks for a scroll once, then stops asking", () => {
    const { state } = start([{ waymark: "a" }]);
    const offScreen = seen({ inView: false });

    const first = observeWaymark(state, offScreen);
    const second = observeWaymark(first.state, offScreen);

    expect(first.scrollTo).toBe(WAYMARK);
    expect(second.scrollTo).toBeUndefined();
  });

  it("keeps asking on a step that scrolls always", () => {
    const { state } = start([{ waymark: "a", scroll: "always" }]);
    const offScreen = seen({ inView: false });

    const first = observeWaymark(state, offScreen);
    const second = observeWaymark(first.state, offScreen);

    expect(second.scrollTo).toBe(WAYMARK);
  });

  it("loses a waymark it has seen, but goes on searching for one it has not", () => {
    const { state } = start([{ waymark: "a" }]);
    const gone = seen({ element: null, rect: null });

    const never = observeWaymark(state, gone);
    expect(never.state.snapshot).toMatchObject({ waymark: { status: "searching" } });

    const found = observeWaymark(state, seen());
    const lost = observeWaymark(found.state, gone);
    expect(lost.state.snapshot).toMatchObject({ waymark: { status: "lost" } });
  });

  it("drops every trace of a step when it leaves it", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, { waymark: "b" }]);

    const looked = observeWaymark(state, seen({ inView: false }));
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
    const looked = observeWaymark(state, seen());

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
    expect(observeWaymark(exited, seen()).state).toBe(exited);
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

  it("keeps startup separate from both observations", () => {
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: { state: () => true } }, {}]);
    const fresh = enter(walkthrough, 0);
    const found = observeWaymark(fresh, seen());
    expect(found.events).toEqual([]);
    expect(found.state).toMatchObject({
      started: false,
      heldSince: undefined,
      snapshot: { stepIndex: 0, waymark: { status: "found" } },
    });
    expect(observeAdvance(found.state, checked({ holds: true }), walkthrough).state).toBe(found.state);

    const started = apply(found.state, { kind: "start" }, walkthrough);
    expect(started.events).toEqual(["start"]);
    expect(apply(started.state, { kind: "start" }, walkthrough).events).toEqual([]);
    const advanced = observeAdvance(started.state, checked({ holds: true }), walkthrough);
    expect(advanced.state.snapshot.stepIndex).toBe(1);
    expect(advanced.events).toEqual(["advance"]);
  });

  it("ignores satisfaction before startup", () => {
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: "click" }, {}]);
    const fresh = { ...enter(walkthrough, 0), mounted: true };

    expect(satisfy(fresh, 1000, walkthrough).state).toBe(fresh);
  });

  it("carries started across steps, so reset does not announce start again", () => {
    const { walkthrough, state } = start([{}, {}]);

    const again = act(state, "reset", walkthrough).state;
    expect(again.started).toBe(true);
    expect(observeWaymark(again, seen()).events).toEqual([]);
  });

  it("drops a click or read stamped with a step the run has since left", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, { waymark: "a", advance: "click" }]);
    const stale: Message = { kind: "click", stepGeneration: state.stepGeneration, hit: "waymark", now: 1000 };
    const staleRead: Message = { kind: "stepRead", stepGeneration: state.stepGeneration, stepRead: { waymark: seen() } };

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
    const check = start([{ waymark: "a", advance: { state: () => true, delayMs: 50 } }]);
    const armed = observeAdvance(check.state, checked({ holds: true }), check.walkthrough).state;
    expect(armed.heldSince).toBe(1000);

    const gone = mount(armed, false).state;
    expect(gone).toMatchObject({ mounted: false, heldSince: undefined });
    expect(mount(gone, false).state).toBe(gone);

    const clickStep = start([{ waymark: "a", advance: { click: true, delayMs: 50 } }]);
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

    const check = start([{ advance: { state: () => false, then: "unlock" } }]);
    expect(liveWatchers(check.state).frame).toBe(true);
    const unlocked = observeAdvance(check.state, checked({ holds: true }), check.walkthrough).state;
    expect(unlocked.snapshot).toMatchObject({ canAdvance: true });
    expect(liveWatchers(unlocked).frame).toBe(false);
  });

  it("attaches to a found waymark, listening for events only while the gate is shut", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: { event: "change", then: "unlock" } }]);
    expect(liveWatchers(state).waymarkAria).toBeUndefined();
    expect(liveWatchers(state).waymarkEvents).toBeUndefined();

    const found = observeWaymark(state, seen()).state;
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
      { kind: "stepRead", stepGeneration: 0, stepRead: { waymark: seen() } },
      { kind: "start" },
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
