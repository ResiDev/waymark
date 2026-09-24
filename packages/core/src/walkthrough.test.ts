import { describe, expect, it } from "vitest";
import { defineWalkthrough } from "./walkthrough";

describe("defineWalkthrough", () => {
  it("rejects a walkthrough with no steps", () => {
    expect(() => defineWalkthrough([])).toThrow(/at least one step/);
  });

  it("rejects a step with both a waymark and a selector", () => {
    expect(() => defineWalkthrough([{}, { waymark: "a", selector: "#a" }])).toThrow(
      /Step 1 sets both/,
    );
  });

  it("rejects an event condition with no events, which could never be met", () => {
    expect(() => defineWalkthrough([{ advance: { event: [] } }])).toThrow(/Step 0 .*no events/);
    expect(() => defineWalkthrough([{ advance: { event: [], then: "unlock" } }])).toThrow(
      /Step 0 .*no events/,
    );
  });

  // Both are type errors; these guard walkthroughs that reach core untyped, as JSON.
  it("rejects an advance object naming more than one condition", () => {
    const step = { advance: { click: true, event: "input" } } as never;
    expect(() => defineWalkthrough([step])).toThrow(/Step 0 advances on click and event/);
  });

  it("rejects advance options with no condition, which could never be met", () => {
    const step = { advance: { then: "unlock" } } as never;
    expect(() => defineWalkthrough([step])).toThrow(/Step 0 .*no click, event or state/);
  });

  it("accepts event conditions that name an event", () => {
    expect(() =>
      defineWalkthrough([
        { advance: { event: "input" } },
        { advance: { event: ["input"], then: "unlock" } },
        { advance: { click: true, delayMs: 50 } },
      ]),
    ).not.toThrow();
  });
});
