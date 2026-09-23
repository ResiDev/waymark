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
    expect(() => defineWalkthrough([{ advance: { when: { event: [] } } }])).toThrow(
      /Step 0 .*no events/,
    );
  });

  it("accepts event conditions that name an event", () => {
    expect(() =>
      defineWalkthrough([
        { advance: { event: "input" } },
        { advance: { when: { event: ["input"] }, then: "unlock" } },
      ]),
    ).not.toThrow();
  });
});
