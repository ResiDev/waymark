import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import type { Rect } from "waymark-core";
import { Button, CloseIcon, LockIcon, PlayIcon, WarningIcon } from "./controls";
import { centerPopover, clamp, placePopover, vertical } from "./placement";
import { color, focusRing, useInteraction, usePalette } from "./theme";
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

const SHADOW = `inset 0 1px 0 ${color.glint}, 0 1px 3px rgb(2 6 23 / 0.1), 0 16px 40px -8px ${color.shadow}`;

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

const APPEAR: Keyframe[] = [
  { opacity: 0, transform: "scale(0.96)" },
  { opacity: 1, transform: "none" },
];
const APPEAR_TIMING: KeyframeAnimationOptions = {
  duration: 140,
  easing: "ease-out",
};

const ARROW = 16;
/** From the cut-out to the popover: the arrow's reach, and a little air past its tip. */
const GAP = 14;

/** A rotated square rather than an SVG, so it inherits the popover's border and background, and a step's `popoverStyle` recolours it too. */
const arrowStyle = (placement: Placement, offset: number): CSSProperties => {
  const along = `clamp(16px, ${offset - ARROW / 2}px, calc(100% - ${16 + ARROW}px))`;
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
    // Only the corner that points at the Waymark, so the tip is soft and the base stays hidden.
    borderRadius: { below: "3px 0 0", left: "0 3px 0 0", above: "0 0 3px", right: "0 0 0 3px" }[placement],
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

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [{ hovered, focused }, interaction] = useInteraction();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      {...interaction}
      style={{
        display: "grid",
        flex: "none",
        placeItems: "center",
        width: 28,
        height: 28,
        // Past the padding, so the cross itself, not its hover square, lines up with the content's edge.
        margin: "-4px -6px -4px auto",
        padding: 0,
        border: 0,
        borderRadius: 8,
        color: hovered ? color.text : color.muted,
        background: hovered ? color.hover : "transparent",
        cursor: "pointer",
        transition: "background-color 120ms, color 120ms",
        ...(focused ? focusRing : null),
      }}
    >
      <CloseIcon />
    </button>
  );
}

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
  const palette = usePalette();
  const popoverRef = useRef<HTMLDivElement>(null);
  useAnimation(popoverRef, APPEAR, APPEAR_TIMING);
  const last = snapshot.stepIndex === snapshot.stepCount - 1;
  const { title } = currentStep;

  return (
    <div
      ref={popoverRef}
      style={{
        ...palette,
        position: "relative",
        boxSizing: "border-box",
        display: "flex",
        width: 360,
        maxWidth: "calc(100vw - 16px)",
        flexDirection: "column",
        // Less above, where the counter's small text sits low in its line, so the four margins look the same.
        padding: "18px 20px 20px",
        color: color.body,
        background: color.raised,
        border: `1px solid ${color.lineStrong}`,
        borderRadius: 14,
        boxShadow: SHADOW,
        fontSize: 15,
        lineHeight: "23px",
        textAlign: "start",
        transformOrigin: waymarkFound ? origin(placement, arrow) : undefined,
        ...currentStep.popoverStyle,
      }}
    >
      {waymarkFound && <div aria-hidden="true" style={arrowStyle(placement, arrow)} />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 20, marginBottom: 6 }}>
        {snapshot.stepCount > 1 && (
          <span
            style={{
              color: color.muted,
              fontSize: 12,
              fontWeight: 500,
              lineHeight: "20px",
              letterSpacing: "0.01em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {labels.stepOf(snapshot.stepIndex + 1, snapshot.stepCount)}
          </span>
        )}
        <CloseButton label={labels.close} onClick={exit} />
      </div>
      {title !== undefined && (
        <div
          style={{
            marginBottom: 6,
            color: color.text,
            fontSize: 17,
            fontWeight: 600,
            lineHeight: "22px",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </div>
      )}
      <div style={{ textWrap: "pretty" }}>{currentStep.content}</div>
      {(snapshot.waymark.status === "lost" || snapshot.waymark.status === "missing") && (
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 14,
            padding: "10px 12px",
            color: color.warn,
            background: color.warnSoft,
            border: `1px solid ${color.warnLine}`,
            borderRadius: 10,
            fontSize: 13,
            lineHeight: "18px",
          }}
        >
          <WarningIcon />
          <span>{labels.missing}</span>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginTop: 20,
        }}
      >
        {skipTask && (
          <Button variant="quiet" onClick={skipTask} style={{ marginLeft: -10 }}>
            {labels.skipTask}
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {snapshot.stepIndex > 0 && (
          <Button variant="secondary" onClick={previous}>
            {labels.previous}
          </Button>
        )}
        <Button variant="primary" onClick={advance} disabled={!snapshot.canAdvance} style={{ minWidth: 88 }}>
          {!snapshot.canAdvance && <LockIcon />}
          {last ? labels.finish : labels.next}
        </Button>
      </div>
    </div>
  );
}

// One ripple and its echo, then a rest: enough to catch the eye, not a light that never stops flashing.
const pulse = (reach: number): Keyframe[] => [
  // From a little past the disc, so a ripple's first frame does not thicken the disc's edge.
  { transform: "scale(1.15)", opacity: 0.6, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" },
  { transform: `scale(${reach})`, opacity: 0, offset: 0.45 },
  { transform: `scale(${reach})`, opacity: 0 },
];
const PULSE = pulse(2);
/** Inside the labelled pill, where a wider ripple would spill past the pill's edge. */
const SMALL_PULSE = pulse(1.5);
const PULSE_TIMING: KeyframeAnimationOptions = { duration: 4000, iterations: Infinity };
const ECHO_TIMING: KeyframeAnimationOptions = { ...PULSE_TIMING, delay: 450 };

/** From the Waymark's corner out to the default beacon's centre: on the corner like a badge, covering only the corner's padding. */
const OUT = 4;
/** Round a Waymark smaller than `SMALL` either way, which has no padding to cover: wholly outside, touching the corner. */
const FAR = 10;
const SMALL = 32;
/** Nearer the top of the screen than this, there is no room above the Waymark, and the default beacon takes the corner below. */
const FLIP = 16;
/** The default beacon's disc, and the disc with the ring round it. */
const DISC = 24;
const RINGED = DISC + 4;
/** What a finger gets to press. */
const PRESS = 40;

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
  const y = rect ? (below ? rect.bottom : rect.top) : viewport.height - 40;
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

const FADE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const FADE_TIMING: KeyframeAnimationOptions = { duration: 120, easing: "ease-out" };

/** An arrow on a disc, so it reads as a way back in and not as a notification's dot. */
function BeaconDisc({ size, hovered, pulsing }: { size: number; hovered: boolean; pulsing: boolean }) {
  const pulseRef = useRef<HTMLSpanElement>(null);
  const echoRef = useRef<HTMLSpanElement>(null);
  const keyframes = size < DISC ? SMALL_PULSE : PULSE;
  useAnimation(pulseRef, keyframes, PULSE_TIMING, pulsing);
  useAnimation(echoRef, keyframes, ECHO_TIMING, pulsing);
  const disc: CSSProperties = {
    display: "grid",
    flex: "none",
    gridArea: "1 / 1",
    placeItems: "center",
    width: size,
    height: size,
    borderRadius: "50%",
    background: color.accent,
  };
  // Edged in the surface colour, so a ripple shows on a page as dark as the accent.
  const ripple: CSSProperties = { ...disc, boxShadow: `0 0 0 1px ${color.surface}`, opacity: 0 };
  return (
    <span style={{ display: "grid", flex: "none", placeItems: "center" }}>
      <span ref={pulseRef} style={ripple} />
      <span ref={echoRef} style={ripple} />
      <span
        style={{
          ...disc,
          // Positioned, to paint over the ripples, which their transforms would otherwise lift above it.
          position: "relative",
          color: color.onAccent,
          // A ring in the surface colour to part it from the page, then a sharp one of the accent: its halo at rest,
          // and all of it where motion is turned off.
          boxShadow: `0 0 0 2px ${color.surface}, 0 0 0 5px ${color.accentRing}, 0 2px 5px 3px rgb(2 6 23 / 0.18)`,
          transform: hovered ? "scale(1.1)" : "none",
          transition: "transform 150ms",
        }}
      >
        <PlayIcon size={Math.round(size * 0.42)} />
      </span>
    </span>
  );
}

function BeaconLabel({ onLeft, children }: { onLeft: boolean; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useAnimation(ref, FADE, FADE_TIMING);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "50%",
        [onLeft ? "right" : "left"]: "100%",
        transform: "translateY(-50%)",
        margin: "0 8px",
        padding: "5px 12px",
        border: `1px solid ${color.lineStrong}`,
        borderRadius: 999,
        color: color.text,
        background: color.raised,
        boxShadow: `inset 0 1px 0 ${color.glint}, 0 1px 3px rgb(2 6 23 / 0.1), 0 8px 20px -6px ${color.shadow}`,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {children}
    </span>
  );
}

/** The default beacon where it belongs: on the corner above the Waymark, or the one below when the Waymark is at the top of the screen. */
export function PlacedDefaultBeacon({ rect, ...props }: BeaconRenderProps & { rect: Rect | null }) {
  const viewport = useViewportSize();
  const below = rect !== null && rect.top < FLIP;
  // Its label opens towards the side of the screen with more room.
  const labelOnLeft = rect !== null && rect.right > viewport.width / 2;
  const out = rect !== null && Math.min(rect.width, rect.height) < SMALL ? FAR : OUT;
  return (
    <BeaconAnchor rect={rect} below={below}>
      <DefaultBeacon {...props} below={below} out={out} labelOnLeft={labelOnLeft} />
    </BeaconAnchor>
  );
}

/** Long enough to read the label once. */
const INTRODUCTION = 2500;

function DefaultBeacon({
  currentStep: { title },
  resume,
  labels,
  waymarkFound,
  below,
  out,
  labelOnLeft,
}: BeaconRenderProps & { below: boolean; out: number; labelOnLeft: boolean }) {
  const palette = usePalette();
  // A beacon new to the page says what it is, once, and then only under the pointer or the keyboard's focus.
  const [introducing, setIntroducing] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntroducing(false), INTRODUCTION);
    return () => clearTimeout(timer);
  }, []);
  // Which step it goes back to, where the step has a name.
  const name = typeof title === "string" ? `${labels.resume}: ${title}` : labels.resume;
  const [{ hovered, focused }, interaction] = useInteraction();
  const active = hovered || focused;

  // With no Waymark to sit on, a dot alone at the bottom of the screen says nothing: it carries its label.
  if (!waymarkFound) {
    return (
      <button
        type="button"
        aria-label={labels.resume}
        onClick={resume}
        {...interaction}
        style={{
          ...palette,
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: 0,
          padding: "7px 16px 7px 8px",
          border: `1px solid ${color.lineStrong}`,
          borderRadius: 999,
          color: color.text,
          background: color.raised,
          // The hover tint is see-through, so it is laid over the pill's own colour.
          backgroundImage: hovered ? `linear-gradient(${color.hover}, ${color.hover})` : "none",
          boxShadow: SHADOW,
          font: "inherit",
          fontSize: 14,
          fontWeight: 500,
          lineHeight: "20px",
          whiteSpace: "nowrap",
          cursor: "pointer",
          transition: "background-color 120ms",
          ...(focused ? focusRing : null),
        }}
      >
        <BeaconDisc size={20} hovered={false} pulsing={!active} />
        {labels.resume}
      </button>
    );
  }

  return (
    // Padded on the Waymark's side, which moves the disc out from the corner it is centred on, and keeps that offset
    // inside what is measured to hold the beacon on screen. The padding lets a press through to the page.
    <span
      style={{
        ...palette,
        display: "grid",
        padding: below ? `${out * 2}px 0 0 ${out * 2}px` : `0 0 ${out * 2}px ${out * 2}px`,
        pointerEvents: "none",
      }}
    >
      {/* The size of the disc, so it is the disc that is held on screen and not the wider button round it. */}
      <span style={{ position: "relative", display: "grid", width: RINGED, height: RINGED, placeItems: "center", pointerEvents: "auto" }}>
        <button
          type="button"
          aria-label={name}
          onClick={resume}
          {...interaction}
            style={{
            display: "grid",
            placeItems: "center",
            flex: "none",
            width: PRESS,
            height: PRESS,
            margin: (RINGED - PRESS) / 2,
            padding: 0,
            border: 0,
            borderRadius: "50%",
            background: "transparent",
            cursor: "pointer",
            ...(focused ? { ...focusRing, outlineOffset: -4 } : null),
          }}
        >
          <BeaconDisc size={DISC} hovered={active} pulsing={!active} />
        </button>
        {(active || introducing) && (
          <BeaconLabel onLeft={labelOnLeft}>
            {labels.resume}
            {title !== undefined && <span style={{ color: color.muted, fontWeight: 400 }}> · {title}</span>}
          </BeaconLabel>
        )}
      </span>
    </span>
  );
}
