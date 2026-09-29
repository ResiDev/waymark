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
    ).toEqual({ placement: "below", top: 160, left: 85, arrow: 40, maxHeight: 332 });
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
    expect(placed).toEqual({ placement: "above", top: 8, left: 8, arrow: 117, maxHeight: 467 });
  });

  it("slides along the preferred side rather than leaving it", () => {
    expect(
      placePopover({
        anchor: { x: 950, y: 400, top: 400, right: 990, bottom: 432, left: 950, width: 40, height: 32 },
        popover: { width: 300, height: 150 },
        viewport: { width: 1000, height: 800 },
        preferred: "below",
        gap: 16,
      }),
    ).toEqual({ placement: "below", top: 448, left: 692, arrow: 278, maxHeight: 376 });
  });

  it("moves a popover capped to its maxHeight off a side with too little room", () => {
    const low = { x: 200, y: 740, top: 740, right: 260, bottom: 768, left: 200, width: 60, height: 28 };
    const place = (height: number) =>
      placePopover({
        anchor: low,
        popover: { width: 320, height },
        viewport: { width: 1000, height: 800 },
        preferred: "below",
        gap: 8,
      });
    // Unmeasured, it fits anywhere; measured, it is only as tall as that first cap allows.
    const capped = Math.min(400, place(0).maxHeight);
    expect(place(capped)).toMatchObject({ placement: "above", top: 332, maxHeight: 724 });
  });

  it("opens below a Waymark in a corner instead of covering it", () => {
    expect(
      placePopover({
        anchor: { x: 950, y: 10, top: 10, right: 990, bottom: 42, left: 950, width: 40, height: 32 },
        popover: { width: 300, height: 150 },
        viewport: { width: 1000, height: 800 },
        preferred: "right",
        gap: 16,
      }),
    ).toEqual({ placement: "below", top: 58, left: 692, arrow: 278, maxHeight: 734 });
  });
});
