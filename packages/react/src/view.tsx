import { useRef, type ReactNode, type RefObject } from "react";
import type { Rect } from "waymark-core";
import { centerPopover, clamp, placePopover } from "./placement";
import { useMeasuredSize } from "./useMeasuredSize";
import { useViewportSize } from "./useViewportSize";
import type { Placement, WalkthroughLabels } from "./types";

// What <WaymarkRoot> draws round any popover and beacon, the app's or the library's: the labels, the shade, and
// where things go. The library's own popover and beacon are in defaults.tsx, which nothing here imports.

export const DEFAULT_LABELS: WalkthroughLabels = {
  next: "Next",
  finish: "Finish",
  previous: "Previous",
  skipTask: "Skip task",
  missing: "Can't find this part of the page. You can still carry on.",
  close: "Close",
  resume: "Resume walkthrough",
  stepOf: (step, count) => `Step ${step} of ${count}`,
};

const SCRIM = "rgb(0 0 0 / 0.5)";

/** Dims the page round the Waymark, or all of it without one. */
export function WaymarkShade({ rect, padding }: { rect: Rect | null; padding: number }) {
  return (
    <div
      aria-hidden="true"
      data-waymark-shade=""
      style={{
        position: "fixed",
        zIndex: 50,
        pointerEvents: "none",
        ...(rect
          ? {
              top: rect.top - padding,
              left: rect.left - padding,
              width: rect.width + padding * 2,
              height: rect.height + padding * 2,
              borderRadius: 8,
              // A ring in the accent, so the cut-out still reads on a page too dark for the shade to change.
              boxShadow: `0 0 0 2px var(--waymark-accent, #2563eb), 0 0 0 9999px ${SCRIM}`,
            }
          : { inset: 0, background: SCRIM }),
      }}
    />
  );
}

/** From the cut-out to the popover: the arrow's reach, and a little air past its tip. */
const GAP = 16;

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

/** Nearer the top of the screen than this, a beacon has no room above its Waymark. */
const FLIP = 16;

/**
 * Pins the beacon's centre to the Waymark's top-right corner, its bottom-right
 * one where the Waymark is at the top of the screen, or the bottom of the
 * screen without a Waymark, kept far enough from the edges that the beacon is
 * never cut off.
 */
export function BeaconAnchor({ rect, children }: { rect: Rect | null; children: ReactNode }) {
  const beaconRef = useRef<HTMLDivElement>(null);
  const size = useMeasuredSize(beaconRef, true);
  const viewport = useViewportSize();
  const reachX = size.width / 2;
  const reachY = size.height / 2;
  const x = rect ? rect.right : viewport.width / 2;
  const y = rect ? (rect.top < FLIP ? rect.bottom : rect.top) : viewport.height - 32;
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
