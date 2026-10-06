import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/500.css";
import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  ACTS,
  at,
  cameraAt,
  captions,
  clamp,
  easeOut,
  focusAt,
  footageFrames,
  FPS,
  frameOf,
  INTRO,
  pointerAt,
  segments,
  shadeAt,
  WIDTH,
  type Rect,
  type Segment,
  type Timeline,
} from "./edit";

export type PromoProps = { timeline: Timeline | null };

const font = '"Inter Variable", system-ui, sans-serif';
const mono = '"JetBrains Mono", ui-monospace, monospace';
const ink = "#15171c";
const muted = "#5b616e";
const faint = "#a4a9b3";
const accent = "#2563eb";

/** The app fills the frame. */
const WINDOW = { left: 0, top: 0, width: WIDTH };

export function Promo({ timeline }: PromoProps) {
  if (!timeline) return null;
  const footage = footageFrames(timeline);
  return (
    <AbsoluteFill style={{ fontFamily: font, color: ink, background: "#f4f3ef" }}>
      <Sequence durationInFrames={INTRO} name="Intro">
        <Intro />
      </Sequence>
      <Sequence from={INTRO} durationInFrames={footage} name="Footage">
        <Footage timeline={timeline} />
      </Sequence>
      <Sequence from={INTRO + footage} name="Outro">
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}

const rise = (frame: number, fps: number, delay = 0): CSSProperties => {
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return { opacity: p, transform: `translateY(${(1 - p) * 20}px)` };
};

const wordmark = (size: number): CSSProperties => ({
  fontSize: size,
  fontWeight: 700,
  letterSpacing: "-0.04em",
});

function Intro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [INTRO - 12, INTRO], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 20, opacity: out }}>
      <div style={{ ...rise(frame, fps), ...wordmark(116) }}>Waymark</div>
      <div style={{ ...rise(frame, fps, 8), fontSize: 40, color: muted, letterSpacing: "-0.01em" }}>
        Walkthroughs that follow your users' lead
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ ...rise(frame, fps), ...wordmark(80) }}>Waymark</div>
        <div style={{ ...rise(frame, fps, 4), fontSize: 38, color: muted, letterSpacing: "-0.01em" }}>
          Walkthroughs that follow your users' lead
        </div>
      </div>
      <div
        style={{
          ...rise(frame, fps, 6),
          padding: "20px 34px",
          border: "1px solid #dcdbd5",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 8px 24px rgb(20 22 28 / 0.06)",
          fontFamily: mono,
          fontSize: 44,
          fontWeight: 500,
        }}
      >
        <span style={{ color: faint }}>$ </span>npm install <span style={{ color: accent }}>react-waymark</span>
      </div>
      <div style={{ ...rise(frame, fps, 12), fontSize: 26, color: muted }}>
        Open source, MIT licensed
      </div>
    </AbsoluteFill>
  );
}

function Footage({ timeline }: { timeline: Timeline }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const all = segments(timeline);
  const total = footageFrames(timeline);
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const leave = interpolate(frame, [total - 12, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: leave }}>
      <div
        style={{
          position: "absolute",
          left: WINDOW.left,
          top: WINDOW.top,
          opacity: enter,
        }}
      >
        <AppFrame timeline={timeline} all={all} frame={frame} />
      </div>
      <div style={{ opacity: enter }}>
        <Text timeline={timeline} all={all} frame={frame} />
      </div>
      <Analytics timeline={timeline} all={all} frame={frame} />
    </AbsoluteFill>
  );
}

// ---- the text: the act's headline and the step under it, in one box on the footage ----

const TEXT = { maxWidth: 1180, inset: 40, pad: 26, headline: 36, line: 28 };
/** Waymark's own shade, so the box reads as part of the tour. */
const SHADE = 0.5;

/** Rough width a string takes at a size, to size and place a box before it is drawn. */
const widthOf = (text: string, size: number, bold = false) => text.length * size * (bold ? 0.5 : 0.46);
/** Rough lines a string takes at a size in a box of this inner width. */
const lines = (text: string, size: number, inner: number, bold = false) =>
  Math.max(1, Math.ceil(widthOf(text, size, bold) / inner));

/** Fades a piece of text in as it starts and out as it ends, in place. */
const fade = (frame: number, start: number, end: number) =>
  easeOut(clamp((frame - start) / 12, 0, 1)) * (1 - easeOut(clamp((frame - end) / 8, 0, 1)));

/** Where a rect of the page lands on the canvas, through the camera. */
function onCanvas(rect: Rect, timeline: Timeline, t: number): Rect {
  const { viewport } = timeline;
  const camera = cameraAt(timeline, t);
  const k = WINDOW.width / viewport.width;
  return {
    x: WINDOW.left + ((rect.x - camera.x) * camera.scale + viewport.width / 2) * k,
    y: WINDOW.top + ((rect.y - camera.y) * camera.scale + viewport.height / 2) * k,
    width: rect.width * camera.scale * k,
    height: rect.height * camera.scale * k,
  };
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

type Box = Rect & { align: "left" | "center" | "right" };
const boxes = new Map<string, Box>();

/**
 * One place along the top for an act's box, kept for the whole act: whichever
 * of left, centre and right the action, and the analytics card, cover least.
 */
function boxFor(timeline: Timeline, all: readonly Segment[], act: Segment["act"]): Box {
  const key = `${timeline.duration}:${act}`;
  const known = boxes.get(key);
  if (known) return known;
  const texts = captions(all).filter((run) => run.act === act && !run.title).map((run) => run.text);
  const headline = ACTS[act].headline;
  const width = Math.min(
    TEXT.maxWidth,
    Math.max(widthOf(headline, TEXT.headline, true), ...texts.map((text) => widthOf(text, TEXT.line))) + TEXT.pad * 2,
  );
  const inner = width - TEXT.pad * 2;
  const height =
    TEXT.pad * 2 +
    lines(headline, TEXT.headline, inner, true) * TEXT.headline * 1.15 +
    8 +
    Math.max(0, ...texts.map((text) => lines(text, TEXT.line, inner))) * TEXT.line * 1.3;
  const y = TEXT.inset;
  const candidates: Box[] = [
    { x: TEXT.inset, y, width, height, align: "left" },
    { x: (WIDTH - width) / 2, y, width, height, align: "center" },
    { x: WIDTH - TEXT.inset - width, y, width, height, align: "right" },
  ];
  const frames = all
    .filter((s) => s.act === act)
    .flatMap((s) => Array.from({ length: Math.ceil(s.frames / 3) }, (_, i) => s.start + i * 3));
  const covered = (box: Box) => {
    let total = 0;
    for (const frame of frames) {
      const { t } = at(all, frame);
      const focus = focusAt(timeline, t);
      if (focus) total += overlap(box, onCanvas(focus, timeline, t));
      if (act === "interrupt") total += overlap(box, ANALYTICS);
    }
    return total;
  };
  const best = candidates.reduce((a, b) => (covered(b) < covered(a) ? b : a));
  boxes.set(key, best);
  return best;
}

function Text({ timeline, all, frame }: { timeline: Timeline; all: readonly Segment[]; frame: number }) {
  const acts = all.filter((s, i) => s.act !== all[i - 1]?.act);
  const steps = captions(all).filter((run) => !run.title);
  const last = all.at(-1)!;
  const { t } = at(all, frame);
  // On the tour's shade the blur alone gives the grey; without one, the box adds the shade's own.
  const tint = 0.12 + (SHADE - 0.12) * (1 - shadeAt(timeline, t));
  return (
    <>
      {acts.map((act, i) => {
        const end = acts[i + 1]?.start ?? last.start + last.frames + 100;
        if (frame < act.start - 1 || frame >= end + 8) return null;
        const box = boxFor(timeline, all, act.act);
        const own = steps.filter((run) => run.act === act.act);
        return (
          <div
            key={act.act}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.width,
              boxSizing: "border-box",
              padding: TEXT.pad,
              borderRadius: 18,
              background: `rgb(0 0 0 / ${tint})`,
              backdropFilter: "blur(14px)",
              color: "#fff",
              textAlign: box.align,
              textWrap: "balance",
              opacity: fade(frame, act.start, end),
            }}
          >
            <div style={{ fontSize: TEXT.headline, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.03em" }}>
              {ACTS[act.act].headline}
            </div>
            {/* Every step of the act stacked in one cell, so the box keeps one size through the act. */}
            <div style={{ display: "grid", marginTop: 8 }}>
              {own.map((run) => (
                <div
                  key={run.start}
                  style={{
                    gridArea: "1 / 1",
                    fontSize: TEXT.line,
                    fontWeight: 450,
                    lineHeight: 1.3,
                    color: "rgb(255 255 255 / 0.9)",
                    opacity: frame >= run.start && frame < run.end + 8 ? fade(frame, run.start, run.end) : 0,
                  }}
                >
                  {run.text}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---- the analytics card ----

const tones: Record<string, string> = {
  "Tour started": "#2563eb",
  "Tour paused": "#d97706",
  "Tour resumed": "#059669",
  "Tour skipped": "#e11d48",
};

/** Where the analytics card sits; the captions keep clear of it. */
const ANALYTICS: Rect = { x: 56, y: 600, width: 450, height: 340 };

/** Seconds of capture between the card arriving and the skip, while the earlier events fill in. */
const CATCH_UP = 2.4;

/**
 * Shown just before the skip. The events from before it pop in one after
 * another; the skip itself lands the moment it happens.
 */
function Analytics({ timeline, all, frame }: { timeline: Timeline; all: readonly Segment[]; frame: number }) {
  const skip = timeline.events.find((e) => e.name === "Tour skipped");
  // oxlint-disable-next-line unicorn/prefer-array-find -- the last match, not the first, and ES2022 has no findLast.
  const last = all.filter((s) => s.act === "interrupt").at(-1);
  if (!skip || !last) return null;
  // Held on act 2's last frame while it fades, as act 3 begins.
  const end = last.start + last.frames;
  const t = frame < end ? at(all, frame).t : last.to;
  const q = easeOut(clamp((frame - end) / 10, 0, 1));
  const arrive = skip.t - CATCH_UP;
  if (t < arrive || q >= 1) return null;
  const earlier = timeline.events.filter((e) => e.t < skip.t);
  const rows = [
    ...earlier.map((event, i) => ({ event, shown: arrive + 0.45 + i * 0.4 })),
    { event: skip, shown: skip.t },
  ].filter((row) => row.shown <= t);
  const p = easeOut(clamp((frame - (frameOf(all, arrive) ?? frame)) / 12, 0, 1));
  return (
    <div
      style={{
        position: "absolute",
        left: ANALYTICS.x,
        top: ANALYTICS.y,
        width: ANALYTICS.width,
        opacity: p * (1 - q),
        transform: `translateY(${(1 - p) * 24}px)`,
        borderRadius: 16,
        border: "1px solid #e2e1db",
        background: "#fff",
        boxShadow: "0 28px 70px rgb(20 22 28 / 0.22), 0 4px 12px rgb(20 22 28 / 0.08)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #eeede8" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
        <span style={{ fontSize: 20, fontWeight: 650 }}>Analytics</span>
        <span style={{ fontSize: 16, color: muted }}>Tour events</span>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 600,
            color: "#047857",
            background: "#ecfdf5",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />
          Live
        </span>
      </div>
      {/* Newest on top. */}
      <div style={{ display: "flex", flexDirection: "column-reverse" }}>
        {rows.map(({ event, shown }, index) => {
          const fresh = easeOut(clamp((t - shown) / 0.3, 0, 1));
          const glow = clamp(1 - (t - shown) / 1.4, 0, 1);
          const age = t - event.t;
          return (
            <div
              key={event.t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "13px 20px",
                borderBottom: index === 0 ? "none" : "1px solid #f2f1ec",
                background: `rgb(37 99 235 / ${0.08 * glow})`,
                opacity: fresh,
                transform: `translateY(${(1 - fresh) * -10}px)`,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: tones[event.name] ?? accent }} />
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 19, fontWeight: 600 }}>{event.name}</div>
                <div style={{ fontSize: 15, color: muted, marginTop: 2 }}>{event.detail}</div>
              </span>
              <span style={{ fontSize: 14, color: faint }}>{age < 3 ? "just now" : `${Math.round(age)}s ago`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- the browser window and the capture inside it ----

/** The app, filling the frame: no address bar or browser chrome to read. */
function AppFrame({ timeline, all, frame }: { timeline: Timeline; all: Segment[]; frame: number }) {
  const { viewport } = timeline;
  const height = (WINDOW.width / viewport.width) * viewport.height;
  return (
    <div
      style={{
        position: "relative",
        width: WINDOW.width,
        height,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: viewport.width,
          height: viewport.height,
          transform: `scale(${WINDOW.width / viewport.width})`,
          transformOrigin: "0 0",
        }}
      >
        <Page timeline={timeline} all={all} frame={frame} />
      </div>
    </div>
  );
}

function Page({ timeline, all, frame }: { timeline: Timeline; all: Segment[]; frame: number }) {
  const { viewport } = timeline;
  const { segment, t } = at(all, frame);
  const camera = cameraAt(timeline, t);
  const pointer = pointerAt(timeline, t);
  const flash = segment.jump ? 1 - clamp((frame - segment.start) / 9, 0, 1) : 0;
  return (
    <div
      style={{
        position: "absolute",
        width: viewport.width,
        height: viewport.height,
        transformOrigin: "0 0",
        transform: `translate(${viewport.width / 2 - camera.x * camera.scale}px, ${viewport.height / 2 - camera.y * camera.scale}px) scale(${camera.scale})`,
      }}
    >
      {all.map((s) => (
        <Sequence key={s.beat} from={s.start} durationInFrames={s.frames} layout="none">
          <OffthreadVideo
            src={staticFile("capture.mp4")}
            trimBefore={Math.round(s.from * FPS)}
            playbackRate={s.speed}
            muted
            style={{ position: "absolute", width: viewport.width, height: viewport.height }}
          />
        </Sequence>
      ))}
      <Clicks timeline={timeline} t={t} />
      <Cursor x={pointer.x} y={pointer.y} t={t} timeline={timeline} zoom={camera.scale} />
      {flash > 0 && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash }} />}
    </div>
  );
}

function Clicks({ timeline, t }: { timeline: Timeline; t: number }) {
  return (
    <>
      {timeline.clicks
        .filter((c) => t >= c.t && t < c.t + 0.5)
        .map((c) => {
          const p = easeOut((t - c.t) / 0.5);
          const r = 8 + p * 22;
          return (
            <span
              key={c.t}
              style={{
                position: "absolute",
                left: c.x - r,
                top: c.y - r,
                width: r * 2,
                height: r * 2,
                borderRadius: "50%",
                border: "2.5px solid rgb(37 99 235 / 0.7)",
                background: "rgb(37 99 235 / 0.12)",
                opacity: 1 - p,
              }}
            />
          );
        })}
    </>
  );
}

function Cursor({ x, y, t, timeline, zoom }: { x: number; y: number; t: number; timeline: Timeline; zoom: number }) {
  const pressed = timeline.clicks.some((c) => t >= c.t - 0.02 && t < c.t + 0.14);
  // Grows a little with the zoom, as a real one would, but not all the way.
  const size = (pressed ? 0.85 : 1) / Math.sqrt(zoom);
  return (
    <svg
      width="26"
      height="34"
      viewBox="0 0 26 34"
      style={{
        position: "absolute",
        left: x - 3,
        top: y - 2,
        transform: `scale(${size})`,
        transformOrigin: "3px 2px",
        filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.3))",
      }}
    >
      <path
        d="M3 2 L3 26 L9.2 20.4 L13.4 30.2 L17.6 28.4 L13.5 18.9 L21.6 18.9 Z"
        fill="#111827"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
