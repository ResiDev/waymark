import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import type { Rect } from "waymark-core";
import { centerPopover, clamp, placePopover, vertical } from "./placement";
import { useMeasuredSize } from "./useMeasuredSize";
import { useViewportSize } from "./useViewportSize";
import type {
  BeaconRenderProps,
  Placement,
  WalkthroughLabels,
  WalkthroughRenderProps,
  WalkthroughStep,
} from "./types";

export const DEFAULT_LABELS: WalkthroughLabels = {
  next: "Next",
  finish: "Finish",
  previous: "Previous",
  skipTask: "Skip task",
  missing:
    "Can't find the part of the page this step points to. You can carry on, but the next steps may not match what you see.",
  close: "Close",
  resume: "Resume walkthrough",
  stepOf: (step, count) => `Step ${step} of ${count}`,
};

// Matches the checklist popover in registry/, so the two read as one design.
const colors = {
  accent: "#2563eb",
  accentStrong: "#1d4ed8",
  surface: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  danger: "#dc2626",
  line: "#e2e8f0",
  hover: "#f1f5f9",
} as const;

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Inline styles can't hold keyframes, and a stylesheet would be one more thing for an app to import. */
function useAnimation(
  ref: RefObject<HTMLElement>,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  running = true,
) {
  useEffect(() => {
    const element = ref.current;
    // jsdom has no Web Animations.
    if (!running || element === null || !("animate" in element) || prefersReducedMotion()) return;
    const animation = element.animate(keyframes, options);
    return () => animation.cancel();
  }, [ref, keyframes, options, running]);
}

function useHover() {
  const [hovered, setHovered] = useState(false);
  return [
    hovered,
    {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
  ] as const;
}

function Button({
  style,
  hoverStyle,
  ...props
}: ComponentPropsWithoutRef<"button"> & { hoverStyle: CSSProperties }) {
  const [hovered, hover] = useHover();
  return (
    <button
      type="button"
      {...props}
      {...hover}
      style={hovered && props.disabled !== true ? { ...style, ...hoverStyle } : style}
    />
  );
}

export function WaymarkShade({
  rect,
  padding,
}: {
  rect: Rect | null;
  padding: number;
}) {
  if (!rect) {
    return (
      <div
        aria-hidden="true"
        data-waymark-shade=""
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          pointerEvents: "none",
          background: "rgba(0, 0, 0, 0.5)",
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      data-waymark-shade=""
      style={{
        position: "fixed",
        zIndex: 50,
        pointerEvents: "none",
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        borderRadius: 8,
        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
      }}
    />
  );
}

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
    ? placePopover({ anchor: rect, popover: size, viewport, preferred, gap: padding + 8 })
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

const APPEAR: Keyframe[] = [
  { opacity: 0, transform: "scale(0.96)" },
  { opacity: 1, transform: "none" },
];
const APPEAR_TIMING: KeyframeAnimationOptions = {
  duration: 140,
  easing: "ease-out",
};

const buttonBase: CSSProperties = {
  margin: 0,
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: "20px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  transition: "background-color 120ms, color 120ms",
};

const quietButton: CSSProperties = {
  ...buttonBase,
  padding: "6px 8px",
  border: 0,
  borderRadius: 8,
  color: colors.muted,
  background: "transparent",
};

const secondaryButton: CSSProperties = {
  ...buttonBase,
  padding: "5px 12px",
  border: `1px solid ${colors.line}`,
  borderRadius: 8,
  color: colors.text,
  background: colors.surface,
};

const primaryButton: CSSProperties = {
  ...buttonBase,
  padding: "6px 14px",
  border: 0,
  borderRadius: 8,
  color: "#ffffff",
  background: colors.accent,
};

const ARROW = 10;

/** A rotated square rather than an SVG, so it inherits the popover's border and background, and a step's `popoverStyle` recolours it too. */
const arrowStyle = (placement: Placement, offset: number): CSSProperties => {
  const along = `clamp(14px, ${offset - ARROW / 2}px, calc(100% - ${14 + ARROW}px))`;
  const out = -ARROW / 2 - 1;
  const edge = (bordered: boolean) => (bordered ? 1 : 0);
  return {
    position: "absolute",
    top: placement === "below" ? out : vertical(placement) ? undefined : along,
    bottom: placement === "above" ? out : undefined,
    left: placement === "right" ? out : vertical(placement) ? along : undefined,
    right: placement === "left" ? out : undefined,
    boxSizing: "border-box",
    width: ARROW,
    height: ARROW,
    borderStyle: "solid",
    borderColor: "inherit",
    borderTopWidth: edge(placement === "below" || placement === "left"),
    borderRightWidth: edge(placement === "above" || placement === "left"),
    borderBottomWidth: edge(placement === "above" || placement === "right"),
    borderLeftWidth: edge(placement === "below" || placement === "right"),
    background: "inherit",
    transform: "rotate(45deg)",
  };
};

/** So it grows out of the arrow. */
const origin = (placement: Placement, arrow: number): string =>
  ({
    below: `${arrow}px 0`,
    above: `${arrow}px 100%`,
    right: `0 ${arrow}px`,
    left: `100% ${arrow}px`,
  })[placement];

export function DefaultPopover<TStep extends WalkthroughStep>({
  currentStep,
  snapshot,
  placement,
  waymarkFound,
  arrow,
  previous,
  advance,
  exit,
  skipTask,
  labels,
}: WalkthroughRenderProps<TStep> & { arrow: number }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  useAnimation(popoverRef, APPEAR, APPEAR_TIMING);
  const last = snapshot.stepIndex === snapshot.stepCount - 1;

  return (
    <div
      ref={popoverRef}
      style={{
        position: "relative",
        boxSizing: "border-box",
        display: "flex",
        width: 300,
        maxWidth: "calc(100vw - 16px)",
        flexDirection: "column",
        gap: 8,
        padding: "12px 16px 16px",
        color: colors.text,
        background: colors.surface,
        border: `1px solid ${colors.line}`,
        borderRadius: 12,
        boxShadow: "0 12px 32px rgb(15 23 42 / 0.18)",
        fontSize: 14,
        lineHeight: 1.5,
        transformOrigin: waymarkFound ? origin(placement, arrow) : undefined,
        ...currentStep.popoverStyle,
      }}
    >
      {waymarkFound && <div aria-hidden="true" style={arrowStyle(placement, arrow)} />}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            color: colors.muted,
            fontSize: 12,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {snapshot.stepCount > 1 &&
            labels.stepOf(snapshot.stepIndex + 1, snapshot.stepCount)}
        </span>
        <Button
          aria-label={labels.close}
          onClick={exit}
          style={{
            ...quietButton,
            display: "grid",
            placeItems: "center",
            width: 28,
            height: 28,
            marginRight: -8,
            padding: 0,
          }}
          hoverStyle={{ color: colors.text, background: colors.hover }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
          </svg>
        </Button>
      </div>
      <div>{currentStep.content}</div>
      {(snapshot.waymark.status === "lost" || snapshot.waymark.status === "missing") && (
        <div style={{ color: colors.danger, fontSize: 13 }}>
          {labels.missing}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        {skipTask && (
          <Button
            onClick={skipTask}
            style={{ ...quietButton, marginLeft: -8 }}
            hoverStyle={{ color: colors.text, background: colors.hover }}
          >
            {labels.skipTask}
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {snapshot.stepIndex > 0 && (
          <Button
            onClick={previous}
            style={secondaryButton}
            hoverStyle={{ background: colors.hover }}
          >
            {labels.previous}
          </Button>
        )}
        <Button
          onClick={advance}
          disabled={!snapshot.canAdvance}
          style={
            snapshot.canAdvance
              ? primaryButton
              : { ...primaryButton, opacity: 0.45, cursor: "not-allowed" }
          }
          hoverStyle={{ background: colors.accentStrong }}
        >
          {last ? labels.finish : labels.next}
        </Button>
      </div>
    </div>
  );
}

const PULSE: Keyframe[] = [
  { transform: "scale(1)", opacity: 0.6 },
  { transform: "scale(3)", opacity: 0 },
];
const PULSE_TIMING: KeyframeAnimationOptions = {
  duration: 2400,
  easing: "cubic-bezier(0, 0, 0.2, 1)",
  iterations: Infinity,
};
const ECHO_TIMING: KeyframeAnimationOptions = { ...PULSE_TIMING, iterationStart: 0.5 };

const dot: CSSProperties = {
  gridArea: "1 / 1",
  width: 10,
  height: 10,
  borderRadius: "50%",
  background: colors.accent,
};

/**
 * Pins the beacon's centre to the Waymark's top-right corner, or the bottom of
 * the screen without one, kept far enough from the edges that the beacon is
 * never cut off.
 */
export function BeaconAnchor({
  rect,
  beaconRef,
  children,
}: {
  rect: Rect | null;
  beaconRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  const size = useMeasuredSize(beaconRef, true);
  const viewport = useViewportSize();
  const reachX = size.width / 2;
  const reachY = size.height / 2;
  const x = rect ? rect.right : viewport.width / 2;
  const y = rect ? rect.top : viewport.height - 32;
  return (
    <div
      ref={beaconRef}
      data-waymark-beacon=""
      style={{
        position: "fixed",
        zIndex: 51,
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

export function DefaultBeacon({ resume, labels }: Pick<BeaconRenderProps, "resume" | "labels">) {
  const pulseRef = useRef<HTMLSpanElement>(null);
  const echoRef = useRef<HTMLSpanElement>(null);
  const [hovered, hover] = useHover();
  useAnimation(pulseRef, PULSE, PULSE_TIMING, !hovered);
  useAnimation(echoRef, PULSE, ECHO_TIMING, !hovered);

  return (
    <button
      type="button"
      aria-label={labels.resume}
      title={labels.resume}
      onClick={resume}
      {...hover}
      style={{
        display: "grid",
        placeItems: "center",
        // The dot at the pulse's full scale, so the pulse is measured with the beacon and kept on screen.
        width: 30,
        height: 30,
        padding: 0,
        border: 0,
        borderRadius: "50%",
        background: "transparent",
        cursor: "pointer",
      }}
    >
      {/* Without motion the first ring rests as a still halo. */}
      <span
        ref={pulseRef}
        style={{ ...dot, opacity: hovered ? 0 : 0.25, transform: "scale(1.8)" }}
      />
      <span ref={echoRef} style={{ ...dot, opacity: 0 }} />
      <span
        style={{
          ...dot,
          boxShadow: "0 0 0 1px #ffffff, 0 1px 4px rgb(15 23 42 / 0.4)",
          transform: hovered ? "scale(1.3)" : "none",
          transition: "transform 150ms",
        }}
      />
    </button>
  );
}
