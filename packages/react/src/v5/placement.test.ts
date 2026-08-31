import { describe, expect, it } from "vitest";
import { placePopover } from "./placement";

const anchor = {
  x: 100,
  y: 100,
  top: 100,
  right: 150,
  bottom: 150,
  left: 100,
  width: 50,
  height: 50,
};

describe("placePopover", () => {
  it("uses the preferred placement when it fits", () => {
    expect(
      placePopover({
        anchor,
        popover: { width: 80, height: 40 },
        viewport: { width: 500, height: 500 },
        preferred: "below",
        gap: 10,
      }),
    ).toEqual({ placement: "below", top: 160, left: 85 });
  });

  it("uses the opposite side before unrelated fallbacks", () => {
    expect(
      placePopover({
        anchor: { ...anchor, top: 450, bottom: 490, y: 450 },
        popover: { width: 80, height: 100 },
        viewport: { width: 500, height: 500 },
        preferred: "below",
        gap: 10,
      }).placement,
    ).toBe("above");
  });

  it("clamps a popover when no side fully fits", () => {
    const placed = placePopover({
      anchor: { ...anchor, top: 5, bottom: 15, y: 5 },
      popover: { width: 600, height: 600 },
      viewport: { width: 500, height: 500 },
      preferred: "above",
      gap: 10,
    });
    expect(placed).toEqual({ placement: "above", top: 8, left: 8 });
  });
});
