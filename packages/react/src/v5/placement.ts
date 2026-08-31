import type { Rect } from "waymark";
import type { Placement } from "./types";

export type PopoverPlacement = Readonly<{
  placement: Placement;
  top: number;
  left: number;
}>;

type Size = Readonly<{ width: number; height: number }>;
type Viewport = Size;

const opposite: Record<Placement, Placement> = {
  above: "below",
  below: "above",
  left: "right",
  right: "left",
};

const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Chooses a side that fits on both axes, then clamps the last-resort position
 * into the viewport. Popover rendering does not need to know the fallback
 * order or repeat overflow arithmetic.
 */
export function placePopover({
  anchor,
  popover,
  viewport,
  preferred = "below",
  gap,
  margin = 8,
}: {
  anchor: Rect;
  popover: Size;
  viewport: Viewport;
  preferred?: Placement;
  gap: number;
  margin?: number;
}): PopoverPlacement {
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  const space: Record<Placement, number> = {
    above: anchor.top - gap - margin,
    below: viewport.height - anchor.bottom - gap - margin,
    left: anchor.left - gap - margin,
    right: viewport.width - anchor.right - gap - margin,
  };

  const fits = (placement: Placement): boolean => {
    if (placement === "above" || placement === "below") {
      return (
        space[placement] >= popover.height &&
        centerX - popover.width / 2 >= margin &&
        centerX + popover.width / 2 <= viewport.width - margin
      );
    }
    return (
      space[placement] >= popover.width &&
      centerY - popover.height / 2 >= margin &&
      centerY + popover.height / 2 <= viewport.height - margin
    );
  };

  const order = unique<Placement>([
    preferred,
    opposite[preferred],
    "below",
    "above",
    "right",
    "left",
  ]);
  const placement = order.find(fits) ?? preferred;

  const raw = {
    below: {
      top: anchor.bottom + gap,
      left: centerX - popover.width / 2,
    },
    above: {
      top: anchor.top - gap - popover.height,
      left: centerX - popover.width / 2,
    },
    right: {
      top: centerY - popover.height / 2,
      left: anchor.right + gap,
    },
    left: {
      top: centerY - popover.height / 2,
      left: anchor.left - gap - popover.width,
    },
  }[placement];

  return {
    placement,
    top: clamp(raw.top, margin, viewport.height - popover.height - margin),
    left: clamp(raw.left, margin, viewport.width - popover.width - margin),
  };
}
