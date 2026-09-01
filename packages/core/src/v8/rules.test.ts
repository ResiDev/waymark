import { describe, expect, it } from "vitest";
import { act, observe } from "./rules";
import type { Reading } from "./rules";
import { enter } from "./state";
import type { State } from "./state";
import { defineTutorial } from "./tutorial";
import type { Step, Tutorial } from "./types";

/**
 * Every rule in Waymark, exercised with plain objects: no document, no frame
 * loop, no elements. `act` and `observe` are the whole of core's behaviour,
 * so this is what it costs to test it.
 */

/** The driver hands back the same element every frame; so does this. */
const WAYMARK = {} as Element;

/** A Waymark that is present, on screen, with its condition unmet. */
const seen = (over: Partial<Reading> = {}): Reading => ({
  element: WAYMARK,
  rect: { x: 0, y: 0, top: 0, right: 10, bottom: 10, left: 0, width: 10, height: 10 },
  inView: true,
  condition: "unmet",
  now: 1000,
  ...over,
});

const frame = (state: State, tutorial: Tutorial, reading: Reading) =>
  observe(state, reading, tutorial);

const start = (steps: readonly Step[]) => {
  const tutorial = defineTutorial(steps);
  return { tutorial, state: enter(tutorial, 0) };
};

describe("rules", () => {
  it("hands back the same state when nothing happened", () => {
    const { tutorial, state } = start([{ waymark: "a" }, {}]);
    const looked = frame(state, tutorial, seen()).state;

    expect(frame(looked, tutorial, seen()).state).toBe(looked);
    expect(frame(looked, tutorial, seen()).events).toEqual([]);
  });

  it("keeps the snapshot when only scratch changed", () => {
    const { tutorial, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);
    const looked = frame(state, tutorial, seen()).state;
    const holding = frame(looked, tutorial, seen({ condition: "holds", now: 1000 }));

    // Arming the clock is scratch; the renderer sees nothing new until it is due.
    expect(holding.state).not.toBe(looked);
    expect(holding.state.heldSince).toBe(1000);
    expect(holding.state.snapshot).toBe(looked.snapshot);
  });

  it("refuses to advance past a gate that is still shut", () => {
    const { tutorial, state } = start([
      { waymark: "a", advance: { when: { state: () => false } } },
      {},
    ]);

    const outcome = act(state, "advance", tutorial);

    expect(outcome.state).toBe(state);
    expect(outcome.events).toEqual([]);
  });

  it("advances once the check has held for the whole delay", () => {
    const { tutorial, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(state, tutorial, seen({ condition: "holds", now: 1000 }));
    expect(armed.state.snapshot.stepIndex).toBe(0);
    expect(armed.state.heldSince).toBe(1000);

    const due = frame(armed.state, tutorial, seen({ condition: "holds", now: 1050 }));
    expect(due.state.snapshot.stepIndex).toBe(1);
    expect(due.events).toEqual(["advance"]);
  });

  it("disarms the clock if the check stops holding before it is due", () => {
    const { tutorial, state } = start([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(state, tutorial, seen({ condition: "holds", now: 1000 }));
    const dropped = frame(armed.state, tutorial, seen({ condition: "unmet", now: 1020 }));
    const late = frame(dropped.state, tutorial, seen({ condition: "holds", now: 1060 }));

    expect(dropped.state.heldSince).toBeUndefined();
    expect(late.state.snapshot.stepIndex).toBe(0); // the clock started again at 1060
    expect(late.state.heldSince).toBe(1060);
  });

  it("stays satisfied even when the delay outlives the click", () => {
    const { tutorial, state } = start([
      { waymark: "a", advance: { when: "click", delayMs: 50 } },
      {},
    ]);

    const clicked = frame(state, tutorial, seen({ condition: "satisfied", now: 1000 }));
    const waiting = frame(clicked.state, tutorial, seen({ now: 1020 }));
    const due = frame(waiting.state, tutorial, seen({ now: 1050 }));

    expect(waiting.state.heldSince).toBe(1000);
    expect(due.state.snapshot.stepIndex).toBe(1);
  });

  it("meets a click condition on the very look that carries the click", () => {
    const { tutorial, state } = start([{ waymark: "a", advance: "click" }, {}]);

    const outcome = frame(state, tutorial, seen({ condition: "satisfied" }));

    expect(outcome.state.snapshot.stepIndex).toBe(1);
    expect(outcome.events).toEqual(["advance"]);
  });

  it("opens the gate without moving when the rule only unlocks", () => {
    const { tutorial, state } = start([
      { waymark: "a", advance: { when: "click", then: "unlock" } },
      {},
    ]);

    const outcome = frame(state, tutorial, seen({ condition: "satisfied" }));

    expect(outcome.state.snapshot).toMatchObject({ stepIndex: 0, canAdvance: true });
    expect(outcome.events).toEqual([]);

    const moved = act(outcome.state, "advance", tutorial);
    expect(moved.state.snapshot.stepIndex).toBe(1);
  });

  it("asks for a scroll once, then stops asking", () => {
    const { tutorial, state } = start([{ waymark: "a" }]);
    const offScreen = seen({ inView: false });

    const first = frame(state, tutorial, offScreen);
    const second = frame(first.state, tutorial, offScreen);

    expect(first.scrollTo).toBe(WAYMARK);
    expect(second.scrollTo).toBeUndefined();
  });

  it("keeps asking on a step that scrolls always", () => {
    const { tutorial, state } = start([{ waymark: "a", scroll: "always" }]);
    const offScreen = seen({ inView: false });

    const first = frame(state, tutorial, offScreen);
    const second = frame(first.state, tutorial, offScreen);

    expect(second.scrollTo).toBe(WAYMARK);
  });

  it("loses a waymark it has seen, but goes on searching for one it has not", () => {
    const { tutorial, state } = start([{ waymark: "a" }]);
    const gone = seen({ element: null, rect: null });

    const never = frame(state, tutorial, gone);
    expect(never.state.snapshot).toMatchObject({ waymark: { status: "searching" } });

    const found = frame(state, tutorial, seen());
    const lost = frame(found.state, tutorial, gone);
    expect(lost.state.snapshot).toMatchObject({ waymark: { status: "lost" } });
  });

  it("drops every trace of a step when it leaves it", () => {
    const { tutorial, state } = start([{ waymark: "a", advance: "click" }, { waymark: "b" }]);

    const looked = frame(state, tutorial, seen({ inView: false }));
    const met = frame(looked.state, tutorial, seen({ condition: "satisfied" }));

    expect(met.state).toMatchObject({
      snapshot: { stepIndex: 1, canAdvance: true, waymark: { status: "searching" } },
      element: null,
      satisfied: false,
      scrolled: false,
      heldSince: undefined,
    });
  });

  it("carries no step scratch once the run is over", () => {
    const { tutorial, state } = start([{ waymark: "a" }]);
    const looked = frame(state, tutorial, seen());

    const exited = act(looked.state, "exit", tutorial);

    expect(exited.state).toMatchObject({
      snapshot: { phase: "exited" },
      element: null,
      scrolled: false,
      heldSince: undefined,
    });
  });

  it("ignores everything but reset once the run is over", () => {
    const { tutorial } = start([{}, {}]);
    const exited = act(enter(tutorial, 1), "exit", tutorial).state;

    expect(act(exited, "advance", tutorial).state).toBe(exited);
    expect(frame(exited, tutorial, seen()).state).toBe(exited);
    expect(act(exited, "reset", tutorial).state.snapshot).toMatchObject({
      phase: "running",
      stepIndex: 0,
    });
  });

  it("announces finishing as well as the advance that finished it", () => {
    const { tutorial } = start([{}, {}]);

    const outcome = act(enter(tutorial, 1), "advance", tutorial);

    expect(outcome.state.snapshot.phase).toBe("completed");
    expect(outcome.events).toEqual(["advance", "finish"]);
  });
});
