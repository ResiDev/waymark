import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import type { Rect } from "waymark-core";
import { centerPopover, clamp, placePopover } from "./placement";
import { color, usePalette } from "./theme";
import { useMeasuredSize } from "./useMeasuredSize";
import { useViewportSize } from "./useViewportSize";
import type { Placement, WalkthroughLabels } from "./types";

// What <WaymarkRoot> draws round any popover and beacon, the app's or the library's: the labels, the shade, and
// where things go. The library's own popover and beacon are in defaultView.tsx, which nothing here imports.

export const DEFAULT_LABELS: WalkthroughLabels = {
  next: "Next",
  finish: "Finish",
  previous: "Previous",
  skipTask: "Skip task",
  missing: (
    <>
      <strong style={{ display: "block", fontSize: 14, fontWeight: 600, lineHeight: "20px" }}>
        Can't find this part of the page
      </strong>
      <span style={{ opacity: 0.85 }}>You can carry on, but later steps may not match what you see.</span>
    </>
  ),
  close: "Close",
  resume: "Resume walkthrough",
  stepOf: (step, count) => `Step ${step} of ${count}`,
};

/** How far the ring reaches past the cut-out. */
const RING = 5;
const MIN_RADIUS = 6;

const px = (value: string, side: number): number => {
  const length = Number.parseFloat(value);
  if (Number.isNaN(length)) return 0;
  return Math.min(value.trim().endsWith("%") ? (side * length) / 100 : length, side / 2);
};

/**
 * How round the Waymark's own corners are, so the ring follows a pill as it
 * does a card. The Run says only where the Waymark is, but it marks the open
 * step's Waymark as this dialog's, which is how the element is found here.
 */
const waymarkRadius = (rect: Rect): number => {
  for (const element of document.querySelectorAll('[aria-haspopup="dialog"][aria-expanded]')) {
    const box = element.getBoundingClientRect();
    if (Math.abs(box.left - rect.left) > 1 || Math.abs(box.top - rect.top) > 1 || Math.abs(box.width - rect.width) > 1) continue;
    return px(getComputedStyle(element).borderTopLeftRadius, Math.min(box.width, box.height));
  }
  return 0;
};

export function WaymarkShade({
  rect,
  padding,
}: {
  rect: Rect | null;
  padding: number;
}) {
  const palette = usePalette();
  const viewport = useViewportSize();
  const shadeRef = useRef<HTMLDivElement>(null);
  // The padding gives way at the edge of the screen, down to none, so the ring round a Waymark there is not cut off.
  const cutOut = rect && {
    top: Math.min(rect.top, Math.max(rect.top - padding, RING)),
    left: Math.min(rect.left, Math.max(rect.left - padding, RING)),
    bottom: Math.max(rect.top + rect.height, Math.min(rect.top + rect.height + padding, viewport.height - RING)),
    right: Math.max(rect.left + rect.width, Math.min(rect.left + rect.width + padding, viewport.width - RING)),
  };
  const room = rect && cutOut ? Math.min(rect.top - cutOut.top, rect.left - cutOut.left) : 0;

  // Set on the element, not through state: the Waymark's corners are read from the page once the cut-out is on it.
  useLayoutEffect(() => {
    const shade = shadeRef.current;
    if (rect === null || shade === null) return;
    shade.style.borderRadius = `${Math.max(MIN_RADIUS, waymarkRadius(rect) + room)}px`;
  }, [rect, room]);

  if (!rect || !cutOut) {
    return (
      <div
        aria-hidden="true"
        data-waymark-shade=""
        style={{
          ...palette,
          position: "fixed",
          inset: 0,
          zIndex: 50,
          pointerEvents: "none",
          background: color.scrim,
        }}
      />
    );
  }

  return (
    <div
      ref={shadeRef}
      aria-hidden="true"
      data-waymark-shade=""
      style={{
        ...palette,
        position: "fixed",
        zIndex: 50,
        pointerEvents: "none",
        top: cutOut.top,
        left: cutOut.left,
        width: cutOut.right - cutOut.left,
        height: cutOut.bottom - cutOut.top,
        // A ring, so the cut-out still reads on a surface too dark for the shade to change.
        boxShadow: `0 0 0 2px ${color.accent}, 0 0 0 ${RING}px ${color.accentRing}, 0 0 0 9999px ${color.scrim}`,
      }}
    />
  );
}

/** From the cut-out to the popover: the arrow's reach, and a little air past its tip. */
const GAP = 14;

/** Placed against `rect`, or in the middle of the screen without one. */
export function Dialog({
  rect,
  preferred,
  padding,
  dialogRef,
  ariaLabel,
  children,
}: {
  rect: Rect | null;
  preferred?: Placement | undefined;
  padding: number;
  dialogRef: RefObject<HTMLDivElement>;
  ariaLabel: string;
  children: (placement: Placement, arrow: number) => ReactNode;
}) {
  const size = useMeasuredSize(dialogRef, true);
  const viewport = useViewportSize();
  const placed = rect
    ? placePopover({ anchor: rect, popover: size, viewport, preferred, gap: padding + GAP })
    : centerPopover({ popover: size, viewport });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{
        position: "fixed",
        zIndex: 51,
        top: placed.top,
        left: placed.left,
        outline: "none",
      }}
    >
      {children(placed.placement, placed.arrow)}
    </div>
  );
}

/**
 * Pins the beacon's centre to the Waymark's top-right corner, or the bottom of
 * the screen without one, kept far enough from the edges that the beacon is
 * never cut off.
 */
export function BeaconAnchor({
  rect,
  below = false,
  children,
}: {
  rect: Rect | null;
  /** The bottom-right corner in place of the top-right. */
  below?: boolean;
  children: ReactNode;
}) {
  const beaconRef = useRef<HTMLDivElement>(null);
  const size = useMeasuredSize(beaconRef, true);
  const viewport = useViewportSize();
  const reachX = size.width / 2;
  const reachY = size.height / 2;
  const x = rect ? rect.right : viewport.width / 2;
  const y = rect ? (below ? rect.bottom : rect.top) : viewport.height - 32;
  return (
    <div
      ref={beaconRef}
      data-waymark-beacon=""
      style={{
        position: "fixed",
        // Under the shade and the popover of a walkthrough that is open, and under a checklist's panel.
        zIndex: 49,
        top: clamp(y, reachY, viewport.height - reachY),
        left: clamp(x, reachX, viewport.width - reachX),
        width: "max-content",
        transform: "translate(-50%, -50%)",
      }}
    >
      {children}
    </div>
  );
}
