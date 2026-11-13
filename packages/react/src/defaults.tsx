import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Button, CLOSE, Icon, PLAY, WARNING } from "./controls";
import { vertical } from "./placement";
import { color, focusRing, useInteraction, usePalette } from "./theme";
import { useViewportSize } from "./useViewportSize";
import type { BeaconRenderProps, Placement, WalkthroughRenderProps, WalkthroughStep } from "./types";

// The library's own popover and beacon. Nothing in the library imports this file: an app does, as `defaultPopover`
// and `defaultBeacon`, and hands them to <WaymarkRoot>, so an app that draws its own ships neither.

const SHADOW = "0 1px 3px rgb(2 6 23 / 0.1), 0 12px 32px -8px rgb(2 6 23 / 0.3)";

/** Inline styles can't hold keyframes, and a stylesheet would be one more thing for an app to import. */
function useAnimation(ref: RefObject<HTMLElement>, keyframes: Keyframe[], options: KeyframeAnimationOptions, running = true) {
  useEffect(() => {
    const element = ref.current;
    // jsdom has no Web Animations or `matchMedia`.
    if (!running || element === null || !("animate" in element)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(keyframes, options);
    return () => animation.cancel();
  }, [ref, keyframes, options, running]);
}

const APPEAR: Keyframe[] = [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1 }];
const APPEAR_TIMING: KeyframeAnimationOptions = { duration: 140, easing: "ease-out" };

const ARROW = 16;

/** Which edge of the popover the arrow is on, and how far its square is turned to point its top-left corner out. */
const ARROW_AT = {
  below: ["top", 45],
  right: ["left", -45],
  above: ["bottom", 225],
  left: ["right", 135],
} as const;

/** A turned square rather than an SVG, so it inherits the popover's border and background, and a step's `popoverStyle` recolours it too. */
const arrowStyle = (placement: Placement, offset: number): CSSProperties => {
  const [edge, turn] = ARROW_AT[placement];
  return {
    position: "absolute",
    [edge]: -ARROW / 2 - 1,
    [vertical(placement) ? "left" : "top"]: `clamp(16px, ${offset - ARROW / 2}px, calc(100% - ${16 + ARROW}px))`,
    boxSizing: "border-box",
    width: ARROW,
    height: ARROW,
    // Only the two sides that show, so the rest of the square is hidden in the popover.
    borderStyle: "solid",
    borderColor: "inherit",
    borderWidth: "1px 0 0 1px",
    borderTopLeftRadius: 3,
    background: "inherit",
    transform: `rotate(${turn}deg)`,
  };
};

function DefaultPopover<TStep extends WalkthroughStep>({
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
}: WalkthroughRenderProps<TStep>) {
  const palette = usePalette();
  const popoverRef = useRef<HTMLDivElement>(null);
  useAnimation(popoverRef, APPEAR, APPEAR_TIMING);
  const { stepIndex, stepCount, canAdvance, waymark } = snapshot;

  return (
    <div
      ref={popoverRef}
      style={{
        ...palette,
        position: "relative",
        boxSizing: "border-box",
        width: 360,
        maxWidth: "calc(100vw - 16px)",
        padding: "18px 20px 20px",
        color: color.text,
        background: color.surface,
        border: `1px solid ${color.line}`,
        borderRadius: 14,
        boxShadow: SHADOW,
        fontSize: 15,
        lineHeight: "23px",
        textAlign: "start",
        ...currentStep.popoverStyle,
      }}
    >
      {waymarkFound && <div aria-hidden="true" style={arrowStyle(placement, arrow)} />}
      <div style={{ display: "flex", alignItems: "center", minHeight: 20, marginBottom: 6, color: color.muted, fontSize: 12, fontWeight: 500, lineHeight: "20px" }}>
        {stepCount > 1 && labels.stepOf(stepIndex + 1, stepCount)}
        {/* Pulled past the padding, so the cross, not its hover square, lines up with the content's edge. */}
        <Button variant="quiet" aria-label={labels.close} onClick={exit} style={{ minHeight: 28, margin: "-4px -7px -4px auto", padding: 6 }}>
          <Icon d={CLOSE} size={14} />
        </Button>
      </div>
      {currentStep.title !== undefined && (
        <div style={{ marginBottom: 6, fontSize: 17, fontWeight: 600, lineHeight: "22px" }}>{currentStep.title}</div>
      )}
      <div>{currentStep.content}</div>
      {(waymark.status === "lost" || waymark.status === "missing") && (
        <div style={{ display: "flex", gap: 10, marginTop: 14, padding: "10px 12px", borderRadius: 10, color: color.warn, background: color.hover, fontSize: 13, lineHeight: "18px" }}>
          <Icon d={WARNING} size={16} />
          <span>{labels.missing}</span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 20 }}>
        {skipTask && (
          <Button variant="quiet" onClick={skipTask} style={{ marginLeft: -12 }}>
            {labels.skipTask}
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {stepIndex > 0 && (
          <Button variant="secondary" onClick={previous}>
            {labels.previous}
          </Button>
        )}
        <Button variant="primary" onClick={advance} disabled={!canAdvance} style={{ minWidth: 88 }}>
          {stepIndex === stepCount - 1 ? labels.finish : labels.next}
        </Button>
      </div>
    </div>
  );
}

// One ripple, then a rest: enough to catch the eye, not a light that never stops flashing.
const PULSE: Keyframe[] = [
  { transform: "none", opacity: 0.6 },
  { transform: "scale(2)", opacity: 0, offset: 0.4 },
  { transform: "scale(2)", opacity: 0 },
];
const PULSE_TIMING: KeyframeAnimationOptions = { duration: 3000, easing: "ease-out", iterations: Infinity };

/** A play arrow on a disc, so it reads as a way back in and not as a notification's dot. */
function Disc({ size, pulsing }: { size: number; pulsing: boolean }) {
  const rippleRef = useRef<HTMLSpanElement>(null);
  useAnimation(rippleRef, PULSE, PULSE_TIMING, pulsing);
  const disc: CSSProperties = {
    display: "grid",
    gridArea: "1 / 1",
    placeItems: "center",
    width: size,
    height: size,
    borderRadius: "50%",
    background: color.accent,
  };
  return (
    <span style={{ display: "grid" }}>
      <span ref={rippleRef} style={{ ...disc, opacity: 0 }} />
      {/* Positioned, to paint over the ripple. A ring in the surface colour parts it from the page; the halo is what is left where motion is turned off. */}
      <span style={{ ...disc, position: "relative", color: color.onAccent, boxShadow: `0 0 0 2px ${color.surface}, 0 0 0 5px ${color.halo}` }}>
        <Icon d={PLAY} size={size / 2} filled />
      </span>
    </span>
  );
}

/** The beacon's name: all of a beacon with no Waymark to sit on, and the label of one that has. */
const pill: CSSProperties = {
  border: `1px solid ${color.line}`,
  borderRadius: 999,
  color: color.text,
  background: color.surface,
  boxShadow: SHADOW,
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: "20px",
  whiteSpace: "nowrap",
};

/** What a finger gets to press, and what is held on screen. */
const PRESS = 40;

function DefaultBeacon({ currentStep: { title }, resume, labels, waymarkFound, rect }: BeaconRenderProps) {
  const palette = usePalette();
  const viewport = useViewportSize();
  const [{ hovered, focused }, interaction] = useInteraction();
  const active = hovered || focused;
  const button = { type: "button", onClick: resume, ...interaction } as const;

  // With no Waymark to sit on, a dot alone at the bottom of the screen says nothing: it carries its name.
  if (!waymarkFound) {
    return (
      <button
        {...button}
        aria-label={labels.resume}
        style={{
          ...palette,
          ...pill,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 16px 7px 8px",
          cursor: "pointer",
          ...(focused ? focusRing : null),
        }}
      >
        <Disc size={20} pulsing={!active} />
        {labels.resume}
      </button>
    );
  }

  return (
    <span style={{ ...palette, position: "relative", display: "grid" }}>
      <button
        {...button}
        // Which step it goes back to, where the step has a name.
        aria-label={typeof title === "string" ? `${labels.resume}: ${title}` : labels.resume}
        style={{
          display: "grid",
          placeItems: "center",
          width: PRESS,
          height: PRESS,
          padding: 0,
          border: 0,
          borderRadius: "50%",
          background: "none",
          cursor: "pointer",
          ...(focused ? { ...focusRing, outlineOffset: -4 } : null),
        }}
      >
        <Disc size={24} pulsing={!active} />
      </button>
      {active && (
        <span
          aria-hidden="true"
          style={{
            ...pill,
            position: "absolute",
            top: "50%",
            // Towards the side of the screen with more room.
            [rect !== null && rect.right > viewport.width / 2 ? "right" : "left"]: "100%",
            transform: "translateY(-50%)",
            padding: "4px 12px",
            pointerEvents: "none",
          }}
        >
          {labels.resume}
          {title !== undefined && <> · {title}</>}
        </span>
      )}
    </span>
  );
}

/** The library's popover, for `renderPopover`. */
export const defaultPopover = (props: WalkthroughRenderProps): ReactNode => <DefaultPopover {...props} />;

/** The library's beacon, for `renderBeacon`. */
export const defaultBeacon = (props: BeaconRenderProps): ReactNode => <DefaultBeacon {...props} />;
