import { describe, expect, it } from "vitest";
import { defineWalkthrough } from "./walkthrough";
import type { Step } from "./types";

const define = (steps: readonly Step[]) => defineWalkthrough({ id: "tour", steps });

describe("defineWalkthrough", () => {
  it("rejects a walkthrough with no steps", () => {
    expect(() => define([])).toThrow(/at least one step/);
  });

  // A type error; this guards walkthroughs that reach core untyped, as JSON.
  it("rejects a walkthrough with no id, which it could not be stored under", () => {
    expect(() => defineWalkthrough({ steps: [{}] } as never)).toThrow(/needs an id/);
    expect(() => defineWalkthrough({ id: "", steps: [{}] })).toThrow(/needs an id/);
  });

  // A type error; this guards walkthroughs that reach core untyped, as JSON.
  it("rejects a step with both a waymark and a selector", () => {
    const step = { waymark: "a", selector: "#a" } as never;
    expect(() => define([{}, step])).toThrow(/Step 1 sets both/);
  });

  it("rejects an event condition with no events, which could never be met", () => {
    expect(() => define([{ waymark: "a", advance: { event: [] } }])).toThrow(/Step 0 .*no events/);
    expect(() => define([{ waymark: "a", advance: { event: [], then: "unlock" } }])).toThrow(/Step 0 .*no events/);
  });

  // Type errors; these guard walkthroughs that reach core untyped, as JSON.
  it("rejects a click or an event with no waymark for it to happen on, which could never be met", () => {
    const click = { advance: "click" } as never;
    const event = { advance: { event: "input", then: "unlock" } } as never;
    expect(() => define([{}, click])).toThrow(/Step 1 advances on a click but has no waymark or selector/);
    expect(() => define([event])).toThrow(/Step 0 advances on an event but has no waymark or selector/);
  });

  it("accepts a state condition with no waymark, which the app's state can meet", () => {
    expect(() => define([{ advance: { state: () => true } }])).not.toThrow();
  });

  // Both are type errors; these guard walkthroughs that reach core untyped, as JSON.
  it("rejects an advance object naming more than one condition", () => {
    const step = { advance: { click: true, event: "input" } } as never;
    expect(() => define([step])).toThrow(/Step 0 advances on click and event/);
  });

  it("rejects advance options with no condition, which could never be met", () => {
    const step = { advance: { then: "unlock" } } as never;
    expect(() => define([step])).toThrow(/Step 0 .*no click, event or state/);
  });

  it("accepts event conditions that name an event", () => {
    expect(() =>
      define([
        { waymark: "a", advance: { event: "input" } },
        { selector: "#a", advance: { event: ["input"], then: "unlock" } },
        { waymark: "a", advance: { click: true, delayMs: 50 } },
      ]),
    ).not.toThrow();
  });

  it("keeps how it is dismissed and its maxAge, and leaves out what it was not given", () => {
    expect(defineWalkthrough({ id: "hint", steps: [{}], dismiss: "exit", maxAge: 1000 })).toEqual({
      id: "hint",
      steps: [{}],
      dismiss: "exit",
      maxAge: 1000,
    });
    expect(Object.keys(define([{}]))).toEqual(["id", "steps"]);
  });
});
