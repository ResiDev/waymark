import { describe, expect, it } from "vitest";
import { act, apply, liveWatchers, mount, observe } from "./rules";
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
  condition: "unmet",
  now: 1000,
  ...over,
});

const frame = (state: State, walkthrough: Walkthrough, read: StepRead) =>
  observe(state, read, walkthrough);

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
    const holding = frame(looked, walkthrough, seen({ condition: "holds", now: 1000 }));

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

    const armed = frame(state, walkthrough, seen({ condition: "holds", now: 1000 }));
    expect(armed.state.snapshot.stepIndex).toBe(0);
    expect(armed.state.heldSince).toBe(1000);

    const due = frame(armed.state, walkthrough, seen({ condition: "holds", now: 1050 }));
    expect(due.state.snapshot.stepIndex).toBe(1);
    expect(due.events).toEqual(["advance"]);
  });

  it("disarms the clock if the check stops holding before it is due", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(state, walkthrough, seen({ condition: "holds", now: 1000 }));
    const dropped = frame(armed.state, walkthrough, seen({ condition: "unmet", now: 1020 }));
    const late = frame(dropped.state, walkthrough, seen({ condition: "holds", now: 1060 }));

    expect(dropped.state.heldSince).toBeUndefined();
    expect(late.state.snapshot.stepIndex).toBe(0); // the clock started again at 1060
    expect(late.state.heldSince).toBe(1060);
  });

  it("stays satisfied even when the delay outlives the click", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: "click", delayMs: 50 } },
      {},
    ]);

    const clicked = frame(state, walkthrough, seen({ condition: "satisfied", now: 1000 }));
    const waiting = frame(clicked.state, walkthrough, seen({ now: 1020 }));
    const due = frame(waiting.state, walkthrough, seen({ now: 1050 }));

    expect(waiting.state.heldSince).toBe(1000);
    expect(due.state.snapshot.stepIndex).toBe(1);
  });

  it("meets a click condition on the very look that carries the click", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, {}]);

    const outcome = frame(state, walkthrough, seen({ condition: "satisfied" }));

    expect(outcome.state.snapshot.stepIndex).toBe(1);
    expect(outcome.events).toEqual(["advance"]);
  });

  it("opens the gate without moving when the rule only unlocks", () => {
    const { walkthrough, state } = start([
      { waymark: "a", advance: { when: "click", then: "unlock" } },
      {},
    ]);

    const outcome = frame(state, walkthrough, seen({ condition: "satisfied" }));

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
    const met = frame(looked.state, walkthrough, seen({ condition: "satisfied" }));

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
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: "click" }, {}]);
    const fresh = enter(walkthrough, 0);

    const first = frame(fresh, walkthrough, seen({ condition: "satisfied" }));

    // The click is not consulted: start comes before anything can move the run.
    expect(first.events).toEqual(["start"]);
    expect(first.state).toMatchObject({
      started: true,
      satisfied: false,
      snapshot: { stepIndex: 0, waymark: { status: "found" } },
    });

    const second = frame(first.state, walkthrough, seen({ condition: "satisfied" }));
    expect(second.state.snapshot.stepIndex).toBe(1);
    expect(second.events).toEqual(["advance"]);
  });

  it("carries started across steps, so reset does not announce start again", () => {
    const { walkthrough, state } = start([{}, {}]);

    const again = act(state, "reset", walkthrough).state;
    expect(again.started).toBe(true);
    expect(frame(again, walkthrough, seen()).events).toEqual([]);
  });

  it("drops a read stamped with a step the run has since left", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: "click" }, { waymark: "a", advance: "click" }]);
    const stale: Message = {
      kind: "read",
      stepGeneration: state.stepGeneration,
      read: seen({ condition: "satisfied" }),
    };

    const moved = apply(state, { kind: "act", action: "advance" }, walkthrough).state;
    expect(moved.snapshot.stepIndex).toBe(0); // the gate is shut; refused

    const clicked = apply(state, stale, walkthrough).state;
    expect(clicked.snapshot.stepIndex).toBe(1);
    expect(apply(clicked, stale, walkthrough).state).toBe(clicked);
  });

  it("drops a state check's clock on unmount, but keeps a satisfied click's", () => {
    const check = start([{ waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } }]);
    const armed = frame(check.state, check.walkthrough, seen({ condition: "holds" })).state;
    expect(armed.heldSince).toBe(1000);

    const gone = mount(armed, false).state;
    expect(gone).toMatchObject({ mounted: false, heldSince: undefined });
    expect(mount(gone, false).state).toBe(gone);

    const click = start([{ waymark: "a", advance: { when: "click", delayMs: 50 } }]);
    const clicked = frame(click.state, click.walkthrough, seen({ condition: "satisfied" })).state;
    expect(mount(clicked, false).state.heldSince).toBe(1000);
  });

  it("wants nothing live unless mounted and running", () => {
    const { walkthrough, state } = start([{ waymark: "a" }]);

    expect(liveWatchers({ ...state, mounted: false })).toEqual({ input: false, frame: false, waymark: undefined });
    expect(liveWatchers(act(state, "exit", walkthrough).state)).toEqual({ input: false, frame: false, waymark: undefined });
  });

  it("wants a frame only while the next look could change something", () => {
    const plain = start([{}]).state;
    expect(liveWatchers(plain).frame).toBe(false);

    const waymark = start([{ waymark: "a" }]).state;
    expect(liveWatchers(waymark).frame).toBe(true);

    const check = start([{ advance: { when: { state: () => false }, then: "unlock" } }]);
    expect(liveWatchers(check.state).frame).toBe(true);
    const unlocked = frame(check.state, check.walkthrough, seen({ element: null, rect: null, condition: "holds" })).state;
    expect(unlocked.snapshot).toMatchObject({ canAdvance: true });
    expect(liveWatchers(unlocked).frame).toBe(false);
  });

  it("attaches to a found waymark, listening for events only while the gate is shut", () => {
    const { walkthrough, state } = start([{ waymark: "a", advance: { when: { event: "change" }, then: "unlock" } }]);
    expect(liveWatchers(state).waymark).toBeUndefined();

    const found = frame(state, walkthrough, seen()).state;
    expect(liveWatchers(found).waymark).toMatchObject({ element: WAYMARK, listening: true, expanded: true });

    const collapsed = act(found, "collapse", walkthrough).state;
    expect(liveWatchers(collapsed).waymark).toMatchObject({ expanded: false });

    const unlocked = frame(found, walkthrough, seen({ condition: "satisfied" })).state;
    expect(liveWatchers(unlocked).waymark).toMatchObject({ listening: false });
  });

  it("folds a whole session from its messages", () => {
    const walkthrough = defineWalkthrough([{ waymark: "a", advance: "click" }, {}]);
    const session: Message[] = [
      { kind: "mounted" },
      { kind: "read", stepGeneration: 0, read: seen() },
      { kind: "read", stepGeneration: 0, read: seen({ condition: "satisfied" }) },
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
