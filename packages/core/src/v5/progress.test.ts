import { describe, expect, it } from "vitest";
import { transition, canAdvance, meetCondition, startAt } from "./progress";
import type { Gates } from "./progress";

const rules = (stepCount: number, gated: readonly number[] = []): Gates => ({
  stepCount,
  gated: (index) => gated.includes(index),
});

describe("progress", () => {
  it("refuses an advance while the gate is shut, and allows it once met", () => {
    const gate = rules(2, [0]);
    const start = startAt(0);

    expect(canAdvance(start, gate)).toBe(false);
    expect(transition(start, "advance", gate)).toBe(start);

    const met = meetCondition(start);
    expect(canAdvance(met, gate)).toBe(true);
    expect(transition(met, "advance", gate).index).toBe(1);
  });

  it("forgets a met condition on every move", () => {
    const gate = rules(3, [0, 1]);
    const moved = transition(meetCondition(startAt(0)), "advance", gate);

    expect(moved.conditionMet).toBe(false);
    expect(canAdvance(moved, gate)).toBe(false);
  });

  it("completes rather than running off the end", () => {
    const done = transition(startAt(1), "advance", rules(2));

    expect(done).toMatchObject({ phase: "completed", index: 1 });
    expect(transition(done, "advance", rules(2))).toBe(done);
    expect(transition(done, "collapse", rules(2))).toBe(done);
  });

  it("returns the same progress for anything it refuses", () => {
    const start = startAt(0);

    expect(transition(start, "previous", rules(2))).toBe(start);
    expect(transition(start, "resume", rules(2))).toBe(start);
    expect(meetCondition(meetCondition(start))).toEqual(meetCondition(start));
  });

  it("collapses and resumes without losing its place", () => {
    const collapsed = transition(startAt(1), "collapse", rules(3));

    expect(collapsed.collapsed).toBe(true);
    expect(transition(collapsed, "resume", rules(3))).toMatchObject({
      index: 1,
      collapsed: false,
    });
  });

  it("restarts from anywhere, and exits from anywhere", () => {
    const exited = transition(startAt(2), "exit", rules(3));

    expect(exited.phase).toBe("exited");
    expect(transition(exited, "reset", rules(3))).toEqual(startAt(0));
  });
});
