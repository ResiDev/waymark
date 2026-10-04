// Tested directly, not through index.ts: jsdom lays nothing out, so reaching
// each placement through a rendered Walkthrough would mean faking every size.
import type { Rect } from "waymark-core";
import type { Placement } from "./types";

export type PopoverPlacement = Readonly<{
  placement: Placement;
  top: number;
  left: number;
  /** How far along the edge facing the anchor its centre falls, for an arrow. */
  arrow: number;
  /**
   * The most room above or below, or the viewport's for a side, for a popover that scrolls
   * rather than leave the screen. Not the room on the side it was placed: capped to that, a
   * popover would always fit there, and never move to a side with more.
   */
  maxHeight: number;
}>;

export type Size = Readonly<{ width: number; height: number }>;
type Viewport = Size;

const opposite: Record<Placement, Placement> = {
  above: "below",
  below: "above",
  left: "right",
  right: "left",
};

const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const vertical = (placement: Placement): boolean =>
  placement === "above" || placement === "below";

/** For a step with nothing to point at: the popover's own centre on the screen's, kept on it. */
export function centerPopover({
  popover,
  viewport,
  margin = 8,
}: {
  popover: Size;
  viewport: Viewport;
  margin?: number;
}): PopoverPlacement {
  return {
    placement: "below",
    top: Math.max(margin, (viewport.height - popover.height) / 2),
    left: Math.max(margin, (viewport.width - popover.width) / 2),
    arrow: popover.width / 2,
    maxHeight: viewport.height - margin * 2,
  };
}

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
  preferred?: Placement | undefined;
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

  const hasRoom = (placement: Placement): boolean =>
    vertical(placement)
      ? space[placement] >= popover.height &&
        popover.width <= viewport.width - 2 * margin
      : space[placement] >= popover.width &&
        popover.height <= viewport.height - 2 * margin;

  const centred = (placement: Placement): boolean =>
    hasRoom(placement) &&
    (vertical(placement)
      ? centerX - popover.width / 2 >= margin &&
        centerX + popover.width / 2 <= viewport.width - margin
      : centerY - popover.height / 2 >= margin &&
        centerY + popover.height / 2 <= viewport.height - margin);

  // The preferred side may slide along the anchor to stay on screen. Another
  // side must sit centred, or else be below or above: beside a header item,
  // left or right only fits by sliding down over the rest of the header.
  const sides: Placement[] = ["below", "above", "right", "left"];
  const placement = hasRoom(preferred)
    ? preferred
    : (unique<Placement>([opposite[preferred], ...sides]).find(centred) ??
      sides.find(hasRoom) ??
      preferred);

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

  const top = clamp(raw.top, margin, viewport.height - popover.height - margin);
  const left = clamp(raw.left, margin, viewport.width - popover.width - margin);
  return {
    placement,
    top,
    left,
    arrow: vertical(placement) ? centerX - left : centerY - top,
    maxHeight: Math.max(
      0,
      vertical(placement) ? Math.max(space.above, space.below) : viewport.height - 2 * margin,
    ),
  };
}
