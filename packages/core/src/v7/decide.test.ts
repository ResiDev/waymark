import { describe, expect, it } from "vitest";
import { decide } from "./decide";
import type { Reading } from "./observe";
import { enterStep } from "./state";
import type { Definition, State } from "./state";
import { advanceRule } from "./tutorial";
import type { Step } from "./types";

/**
 * Every rule in Waymark, exercised with plain objects: no document, no frame
 * loop, no elements. `decide` is the whole of core's behaviour, so this is what
 * it costs to test it.
 */

const define = (steps: readonly Step[]): Definition => ({
  steps,
  rules: steps.map(advanceRule),
});

/** The driver hands back the same element every frame; so does this. */
const WAYMARK = {} as Element;

/** A Waymark that is present, on screen, and whose check does not hold. */
const seen = (over: Partial<Reading> = {}): Reading => ({
  element: WAYMARK,
  rect: { x: 0, y: 0, top: 0, right: 10, bottom: 10, left: 0, width: 10, height: 10 },
  inView: true,
  conditionHolds: false,
  now: 1000,
  ...over,
});

const frame = (state: State, definition: Definition, reading: Reading) =>
  decide(state, { kind: "frame", reading }, definition);

describe("decide", () => {
  it("hands back the same state when nothing happened", () => {
    const definition = define([{ waymark: "a" }, {}]);
    const state = frame(enterStep(0, definition), definition, seen()).state;

    expect(frame(state, definition, seen()).state).toBe(state);
  });

  it("refuses to advance past a gate that is still shut", () => {
    const definition = define([
      { waymark: "a", advance: { when: { state: () => false } } },
      {},
    ]);
    const state = enterStep(0, definition);

    const outcome = decide(state, { kind: "act", action: "advance" }, definition);

    expect(outcome.state).toBe(state);
    expect(outcome.announcements).toEqual([]);
  });

  it("advances once the check has held for the whole delay", () => {
    const definition = define([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(enterStep(0, definition), definition, seen({ conditionHolds: true, now: 1000 }));
    expect(armed.state.index).toBe(0);
    expect(armed.state.dueAt).toBe(1050);

    const due = frame(armed.state, definition, seen({ conditionHolds: true, now: 1050 }));
    expect(due.state.index).toBe(1);
    expect(due.announcements).toEqual([{ type: "advance", stepIndex: 0 }]);
  });

  it("disarms the clock if the check stops holding before it is due", () => {
    const definition = define([
      { waymark: "a", advance: { when: { state: () => true }, delayMs: 50 } },
      {},
    ]);

    const armed = frame(enterStep(0, definition), definition, seen({ conditionHolds: true, now: 1000 }));
    const dropped = frame(armed.state, definition, seen({ conditionHolds: false, now: 1020 }));
    const late = frame(dropped.state, definition, seen({ conditionHolds: true, now: 1060 }));

    expect(dropped.state.dueAt).toBeUndefined();
    expect(late.state.index).toBe(0); // the clock started again at 1060
    expect(late.state.dueAt).toBe(1110);
  });

  it("opens the gate without moving when the rule only unlocks", () => {
    const definition = define([
      { waymark: "a", advance: { when: "click", then: "unlock" } },
      {},
    ]);

    const outcome = decide(
      enterStep(0, definition),
      { kind: "conditionMet", now: 1000 },
      definition,
    );

    expect(outcome.state).toMatchObject({ index: 0, conditionMet: true });
    expect(outcome.announcements).toEqual([]);
  });

  it("asks for a scroll once, then stops asking", () => {
    const definition = define([{ waymark: "a" }]);
    const offScreen = seen({ inView: false });

    const first = frame(enterStep(0, definition), definition, offScreen);
    const second = frame(first.state, definition, offScreen);

    expect(first.scrollTo).toBe(WAYMARK);
    expect(second.scrollTo).toBeUndefined();
  });

  it("keeps asking on a step that scrolls always", () => {
    const definition = define([{ waymark: "a", scroll: "always" }]);
    const offScreen = seen({ inView: false });

    const first = frame(enterStep(0, definition), definition, offScreen);
    const second = frame(first.state, definition, offScreen);

    expect(second.scrollTo).toBe(WAYMARK);
  });

  it("loses a waymark it has seen, but goes on searching for one it has not", () => {
    const definition = define([{ waymark: "a" }]);
    const gone = seen({ element: null, rect: null });

    const never = frame(enterStep(0, definition), definition, gone);
    expect(never.state.location).toEqual({ status: "searching" });

    const found = frame(enterStep(0, definition), definition, seen());
    const lost = frame(found.state, definition, gone);
    expect(lost.state.location).toEqual({ status: "lost" });
  });

  it("drops every trace of a step when it leaves it", () => {
    const definition = define([{ waymark: "a", advance: "click" }, { waymark: "b" }]);

    const looked = frame(enterStep(0, definition), definition, seen({ inView: false }));
    const met = decide(looked.state, { kind: "conditionMet", now: 1000 }, definition);

    expect(met.state).toMatchObject({
      index: 1,
      conditionMet: false,
      element: null,
      hasScrolled: false,
      dueAt: undefined,
      location: { status: "searching" },
    });
  });

  it("carries no step scratch once the run is over", () => {
    const definition = define([{ waymark: "a" }]);
    const looked = frame(enterStep(0, definition), definition, seen());

    const exited = decide(looked.state, { kind: "act", action: "exit" }, definition);

    expect(exited.state).toMatchObject({
      phase: "exited",
      element: null,
      hasScrolled: false,
      dueAt: undefined,
    });
  });

  it("ignores everything but reset once the run is over", () => {
    const definition = define([{}, {}]);
    const exited = decide(enterStep(1, definition), { kind: "act", action: "exit" }, definition).state;

    expect(decide(exited, { kind: "act", action: "advance" }, definition).state).toBe(exited);
    expect(decide(exited, { kind: "frame", reading: seen() }, definition).state).toBe(exited);
    expect(decide(exited, { kind: "act", action: "reset" }, definition).state).toMatchObject({
      phase: "running",
      index: 0,
    });
  });

  it("announces finishing as well as the advance that finished it", () => {
    const definition = define([{}, {}]);
    const last = enterStep(1, definition);

    const outcome = decide(last, { kind: "act", action: "advance" }, definition);

    expect(outcome.state.phase).toBe("completed");
    expect(outcome.announcements).toEqual([
      { type: "advance", stepIndex: 1 },
      { type: "finish", stepIndex: 1 },
    ]);
  });
});
