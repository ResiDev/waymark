import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Button, CLOSE, Icon, PLAY } from "./controls";
import { vertical } from "./placement";
import { color, useHover } from "./theme";
import { useViewportSize } from "./useViewportSize";
import type { BeaconRenderProps, Placement, WalkthroughRenderProps, WalkthroughStep } from "./types";

// The library's own popover and beacon. Nothing in the library imports this file: an app does, as `defaultPopover`
// and `defaultBeacon`, and hands them to <WaymarkRoot>, so an app that draws its own ships neither.

const SHADOW = "0 1px 3px rgb(2 6 23 / 0.1), 0 12px 32px -8px rgb(2 6 23 / 0.3)";

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
  const { stepIndex, stepCount, canAdvance, waymark } = snapshot;

  return (
    <div
      style={{
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
      {waymarkFound && <div style={arrowStyle(placement, arrow)} />}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6, color: color.muted, fontSize: 12, fontWeight: 500, lineHeight: "20px" }}>
        {stepCount > 1 && labels.stepOf(stepIndex + 1, stepCount)}
        {/* Pulled past its padding and the room round its strokes, so the cross, not its hover square, lines up with the content's edge. */}
        <Button variant="quiet" aria-label={labels.close} onClick={exit} style={{ minHeight: 28, margin: "-4px -10px -4px auto", padding: 6 }}>
          <Icon d={CLOSE} size={14} />
        </Button>
      </div>
      {currentStep.title !== undefined && (
        <div style={{ marginBottom: 6, fontSize: 17, fontWeight: 600, lineHeight: "22px" }}>{currentStep.title}</div>
      )}
      <div>{currentStep.content}</div>
      {(waymark.status === "lost" || waymark.status === "missing") && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: color.hover, fontSize: 13, lineHeight: "18px" }}>
          {labels.missing}
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
        <Button variant="primary" onClick={advance} disabled={!canAdvance}>
          {stepIndex === stepCount - 1 ? labels.finish : labels.next}
        </Button>
      </div>
    </div>
  );
}

// One ripple, then a rest: enough to catch the eye, not a light that never stops flashing. The rest is the time
// after the last frame, which the browser fills with the ripple as it is styled: unseen.
const PULSE: Keyframe[] = [{ opacity: 0.6 }, { transform: "scale(2.5)", opacity: 0, offset: 0.4 }];
const PULSE_TIMING: KeyframeAnimationOptions = { duration: 3000, easing: "ease-out", iterations: Infinity };

/** What a finger gets to press, and what is held on screen. */
const PRESS = 40;
const DISC = 24;
/** How far the beacon's name reaches back under the disc: all the way, to the halo's far edge, so the two are one chip. */
const TUCK = 37;

/** A play arrow on a disc, so it reads as a way back in and not as a notification's dot. */
function DefaultBeacon({ currentStep: { title }, resume, labels, waymarkFound, rect }: BeaconRenderProps) {
  const viewport = useViewportSize();
  // Under the pointer or the keyboard's focus.
  const [active, hover, setActive] = useHover();
  // Its name shows while it is asked for. With no Waymark to sit on, a dot alone at the bottom of the screen says nothing, so there it always shows.
  const named = active || !waymarkFound;
  const rippleRef = useRef<HTMLSpanElement>(null);
  // Inline styles can't hold keyframes, and a stylesheet would be one more thing for an app to import.
  useEffect(() => {
    const ripple = rippleRef.current;
    // Still under its name, and where motion is turned off. jsdom has no Web Animations.
    if (named || ripple === null || !("animate" in ripple)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = ripple.animate(PULSE, PULSE_TIMING);
    return () => animation.cancel();
  }, [named]);
  const disc: CSSProperties = {
    display: "grid",
    gridArea: "1 / 1",
    placeItems: "center",
    width: DISC,
    height: DISC,
    borderRadius: "50%",
    background: color.accent,
  };

  return (
    <button
      type="button"
      // Which step it goes back to, where the step has a name.
      aria-label={typeof title === "string" ? `${labels.resume}: ${title}` : labels.resume}
      onClick={resume}
      {...hover}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: PRESS,
        gridAutoFlow: "column",
        placeItems: "center",
        height: PRESS,
        padding: 0,
        border: 0,
        borderRadius: PRESS,
        background: "none",
        font: "inherit",
        cursor: "pointer",
        outlineColor: color.accent,
        // Drawn in, to where the halo was, so the ring fits the chip's end.
        outlineOffset: -6,
      }}
    >
      <span ref={rippleRef} style={{ ...disc, opacity: 0 }} />
      {named && (
        <span
          aria-hidden="true"
          style={{
            // Beside the button on a Waymark, so the disc stays on its corner. With no Waymark it is part of the
            // button's row, so the two are centred and held on screen as one.
            position: waymarkFound ? "absolute" : "static",
            // Behind the button's focus ring, so the whole ring shows.
            zIndex: -1,
            // As tall as the halo, whose place it takes.
            padding: "6px 12px",
            // Out from under the disc, as one chip with it, towards the side of the screen with more room.
            ...(rect !== null && rect.right > viewport.width / 2
              ? { right: "100%", marginRight: -TUCK, paddingRight: TUCK }
              : { left: "100%", marginLeft: -TUCK, paddingLeft: TUCK }),
            border: `1px solid ${color.line}`,
            borderRadius: 999,
            color: color.text,
            background: color.surface,
            boxShadow: SHADOW,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: "20px",
            whiteSpace: "nowrap",
          }}
        >
          {labels.resume}
          {title !== undefined && <> · {title}</>}
        </span>
      )}
      {/* Positioned, to paint over the ripple and its name. A ring in the arrow's colour parts it from the page; the halo is what is left where motion is turned off. */}
      <span style={{ ...disc, position: "relative", color: color.onAccent, boxShadow: `0 0 0 2px ${color.onAccent}, 0 0 0 5px ${named ? "transparent" : color.halo}` }}>
        <Icon d={PLAY} size={DISC} />
      </span>
    </button>
  );
}

/** The library's popover, for `renderPopover`. */
export const defaultPopover = (props: WalkthroughRenderProps): ReactNode => <DefaultPopover {...props} />;

/** The library's beacon, for `renderBeacon`. */
export const defaultBeacon = (props: BeaconRenderProps): ReactNode => <DefaultBeacon {...props} />;
