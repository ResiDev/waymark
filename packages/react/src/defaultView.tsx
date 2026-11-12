import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Rect } from "waymark-core";
import { Button, CloseIcon, LockIcon, PlayIcon, WarningIcon } from "./controls";
import { vertical } from "./placement";
import { color, focusRing, useInteraction, usePalette } from "./theme";
import { useViewportSize } from "./useViewportSize";
import type { BeaconRenderProps, DefaultView, Placement, WalkthroughRenderProps, WalkthroughStep } from "./types";
import { BeaconAnchor } from "./view";

// The library's own popover and beacon. Reached only through `defineWalkthrough`, which hands them to each
// walkthrough, so an app that defines none does not ship them.

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

const APPEAR: Keyframe[] = [
  { opacity: 0, transform: "scale(0.96)" },
  { opacity: 1, transform: "none" },
];
const APPEAR_TIMING: KeyframeAnimationOptions = {
  duration: 140,
  easing: "ease-out",
};

const ARROW = 16;

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

/** Nearer the top of the screen than this, there is no room above the Waymark, and the default beacon takes the corner below. */
const FLIP = 16;
const DISC = 24;
/** What a finger gets to press, and what is held on screen. */
const PRESS = 40;

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
        // The press area already stands the label off the disc.
        margin: "0 2px",
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
function PlacedDefaultBeacon({ rect, ...props }: BeaconRenderProps & { rect: Rect | null }) {
  const viewport = useViewportSize();
  const below = rect !== null && rect.top < FLIP;
  // Its label opens towards the side of the screen with more room.
  const labelOnLeft = rect !== null && rect.right > viewport.width / 2;
  return (
    <BeaconAnchor rect={rect} below={below}>
      <DefaultBeacon {...props} labelOnLeft={labelOnLeft} />
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
  labelOnLeft,
}: BeaconRenderProps & { labelOnLeft: boolean }) {
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
    <span style={{ ...palette, position: "relative", display: "grid" }}>
      <button
        type="button"
        aria-label={name}
        onClick={resume}
        {...interaction}
        style={{
          display: "grid",
          placeItems: "center",
          width: PRESS,
          height: PRESS,
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
  );
}

export const defaultView: DefaultView = { popover: DefaultPopover, beacon: PlacedDefaultBeacon };
