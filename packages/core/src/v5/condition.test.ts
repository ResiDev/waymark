import { describe, expect, it, vi } from "vitest";
import { trackCondition } from "./condition";
import type { AdvanceRule } from "./tutorial";

const rule = (over: Partial<AdvanceRule> = {}): AdvanceRule => ({
  byClick: false,
  byEvents: [],
  byCheck: undefined,
  auto: true,
  delayMs: 0,
  ...over,
});

describe("trackCondition", () => {
  it("reports a satisfied condition at once when there is no delay", () => {
    const onMet = vi.fn();
    const tracker = trackCondition(rule(), onMet);

    tracker.satisfy(1000);

    expect(onMet).toHaveBeenCalledTimes(1);
  });

  it("waits out the delay, counting from when the condition was first met", () => {
    const onMet = vi.fn();
    const tracker = trackCondition(rule({ delayMs: 100 }), onMet);

    tracker.satisfy(1000);
    tracker.observe(null, 1050);
    expect(onMet).not.toHaveBeenCalled();

    tracker.observe(null, 1100);
    expect(onMet).toHaveBeenCalledTimes(1);
  });

  it("reports once, however often it is asked afterwards", () => {
    const onMet = vi.fn();
    const tracker = trackCondition(rule({ byCheck: () => true }), onMet);

    for (let now = 0; now < 5; now++) tracker.observe(null, now);

    expect(onMet).toHaveBeenCalledTimes(1);
  });

  it("requires a state check to still hold when its delay comes due", () => {
    const onMet = vi.fn();
    let holds = true;
    const tracker = trackCondition(
      rule({ byCheck: () => holds, delayMs: 100 }),
      onMet,
    );

    tracker.observe(null, 1000); // arms: due at 1100
    holds = false;
    tracker.observe(null, 1050); // disarms
    holds = true;
    tracker.observe(null, 1100); // re-arms: due at 1200
    expect(onMet).not.toHaveBeenCalled();

    tracker.observe(null, 1200);
    expect(onMet).toHaveBeenCalledTimes(1);
  });

  it("listens to the element it is shown, and stops when released", () => {
    const onMet = vi.fn();
    const element = document.createElement("button");
    const tracker = trackCondition(rule({ byEvents: ["change"] }), onMet);

    tracker.observe(element, 0);
    element.dispatchEvent(new Event("change"));
    expect(onMet).toHaveBeenCalledTimes(1);

    const again = trackCondition(rule({ byEvents: ["change"] }), onMet);
    again.observe(element, 0);
    again.release();
    element.dispatchEvent(new Event("change"));
    expect(onMet).toHaveBeenCalledTimes(1);
  });
});
