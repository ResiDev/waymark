/**
 * The edit, as data: which beats of the capture play, how fast, and what the
 * captions say. Everything else in the video is worked out from these and
 * from the timeline record.ts writes, so a re-recording needs no changes here
 * unless the storyboard itself changes.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** What record.ts writes to capture.json. Times are seconds into capture.mp4. */
export type Timeline = {
  viewport: { width: number; height: number };
  scale: number;
  fps: number;
  duration: number;
  beats: { id: string; start: number; end: number }[];
  focus: { t: number; rect: Rect }[];
  pointer: { t: number; x: number; y: number }[];
  clicks: { t: number; x: number; y: number }[];
  reloads: { t: number }[];
  /** What the app sent to analytics. */
  events: { t: number; name: string; detail: string }[];
  /** When Waymark's shade came and went. */
  shade: { t: number; on: boolean }[];
};

export const FPS = 30;
export const WIDTH = 1920;
/** 16:10, the app's own shape, so it can fill the frame. */
export const HEIGHT = 1200;
export const INTRO = Math.round(2.6 * FPS);
export const OUTRO = Math.round(3.2 * FPS);

export type Act = Readonly<{ label: string; headline: string }>;

export const ACTS = {
  advance: { label: "Auto-advance", headline: "Tours that move when your users do" },
  interrupt: { label: "Interruptions and analytics", headline: "Interruption-friendly, and measurable" },
  checklists: { label: "Checklists", headline: "Onboarding on their schedule" },
} satisfies Record<string, Act>;

type Cut = Readonly<{
  beat: string;
  act: keyof typeof ACTS;
  /** Above 1 plays faster than it was recorded. Never below 1: the recording holds long enough to read. */
  speed: number;
  /** Seconds left off the start of the beat. */
  trim?: number;
  /** The act's headline, or the next part of what it says. Without either, the last caption stays. */
  title?: true;
  say?: string;
}>;

/** Every beat record.ts logs, in order. */
export const CUTS: readonly Cut[] = [
  { beat: "a1-title", act: "advance", speed: 1, trim: 0.5, title: true, say: "This step will automatically progress as soon as the user clicks Invite." },
  { beat: "a1-click", act: "advance", speed: 1 },
  { beat: "a1-state", act: "advance", speed: 1, say: "This step will automatically progress as soon as a valid email is entered." },
  { beat: "a1-done", act: "advance", speed: 1, say: "And now sending the invite will automatically complete the tour." },
  { beat: "a1-send", act: "advance", speed: 1 },
  { beat: "a2-title", act: "interrupt", speed: 1.44, title: true, say: "Tours can be started automatically too — such as a user opening their own projects." },
  { beat: "a2-reload", act: "interrupt", speed: 1.44, say: "Even an accidental reload keeps the tour on the same step." },
  { beat: "a2-away", act: "interrupt", speed: 1.44, say: "Clicking anywhere else pauses the tour and hides the popover." },
  { beat: "a2-beacon", act: "interrupt", speed: 1.44, say: "A pulsing dot attaches to the last step. Clicking it reopens the tour, allowing the user to move at their own pace." },
  { beat: "a2-skip", act: "interrupt", speed: 1.44, say: "Waymark reports every start, pause, resume and skip, ready for your analytics." },
  { beat: "a3-title", act: "checklists", speed: 1, title: true, say: "The checklist lays out what to learn. Users decide when." },
  { beat: "a3-pick", act: "checklists", speed: 1, say: "Each item has its own short tour, which runs only when the user asks." },
  { beat: "a3-tour", act: "checklists", speed: 1.65 },
  { beat: "a3-tick", act: "checklists", speed: 1, say: "Finishing the tour ticks the item off." },
  { beat: "a3-owner", act: "checklists", speed: 1.2, say: "Doing the task without the tour ticks it off too." },
  { beat: "a3-auto", act: "checklists", speed: 1 },
];

/** What the caption card says, frame by frame of the footage. */
export function captions(all: readonly Segment[]) {
  const out: { act: Segment["act"]; text: string; title: boolean; start: number; end: number }[] = [];
  for (const s of all) {
    const end = s.start + s.frames;
    const text = s.say ?? (s.title ? ACTS[s.act].headline : undefined);
    const last = out.at(-1);
    if (text === undefined && last) last.end = end;
    else out.push({ act: s.act, text: text ?? "", title: s.title === true && s.say === undefined, start: s.start, end });
  }
  return out;
}

/** Seconds to read a caption: a moment to look, then about 240 words a minute. */
export const readingTime = (text: string) => 0.8 + text.split(/\s+/).length * 0.25;
/** Real time at the slowest: slowed footage feels off even when no one can say why. */
const MIN_SPEED = 1;

export type Segment = Cut & Act & {
  /** Seconds into the capture. */
  from: number;
  to: number;
  /** Frames into the footage section of the video. */
  start: number;
  frames: number;
  /** Whether the capture jumps here, rather than running on from the segment before. */
  jump: boolean;
};

export function segments(timeline: Timeline): Segment[] {
  let start = 0;
  let previous: Segment | null = null;
  const beatOf = (cut: Cut) => {
    const beat = timeline.beats.find((b) => b.id === cut.beat);
    if (!beat) throw new Error(`capture.json has no beat "${cut.beat}". Run pnpm record again.`);
    return beat;
  };
  // oxlint-disable-next-line oxc/no-map-spread -- CUTS is the edit itself, so each segment is a new object, never a change to it.
  return CUTS.map((cut, index) => {
    const beat = beatOf(cut);
    // On a frame, so the camera and cursor agree with the frame the video shows.
    const from = Math.round((beat.start + (cut.trim ?? 0)) * FPS) / FPS;
    // A caption stays through the beats after it that bring none, so those count towards reading it.
    let after = 0;
    for (const next of CUTS.slice(index + 1)) {
      if (next.say !== undefined || next.title) break;
      after += (beatOf(next).end - beatOf(next).start) / next.speed;
    }
    // Slowed, if need be, so the caption it brings can be read in comfort.
    const needed = cut.say ? readingTime(cut.say) - after : 0;
    const speed = needed > 0 ? Math.min(cut.speed, Math.max(MIN_SPEED, (beat.end - from) / needed)) : cut.speed;
    const frames = Math.round(((beat.end - from) / speed) * FPS);
    const segment: Segment = {
      ...cut,
      ...ACTS[cut.act],
      speed,
      from,
      to: beat.end,
      start,
      frames,
      jump: previous !== null && Math.abs(previous.to - from) > 0.05,
    };
    start += frames;
    previous = segment;
    return segment;
  });
}

export const footageFrames = (timeline: Timeline) =>
  segments(timeline).reduce((total, segment) => total + segment.frames, 0);

/** The segment playing at a frame of the footage section, and the capture time it shows. */
export function at(all: readonly Segment[], frame: number): { segment: Segment; t: number } {
  let segment = all[0]!;
  for (const s of all) if (s.start <= frame) segment = s;
  return { segment, t: segment.from + ((frame - segment.start) / FPS) * segment.speed };
}

// ---- easing and interpolation ----

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const easeOut = (p: number) => 1 - (1 - p) ** 3;
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** The pointer at capture time `t`, between the samples record.ts took. */
export function pointerAt(timeline: Timeline, t: number) {
  const samples = timeline.pointer;
  const next = samples.findIndex((s) => s.t > t);
  if (next === -1) return samples.at(-1)!;
  if (next === 0) return samples[0]!;
  const a = samples[next - 1]!;
  const b = samples[next]!;
  const p = clamp((t - a.t) / (b.t - a.t), 0, 1);
  return { t, x: mix(a.x, b.x, p), y: mix(a.y, b.y, p) };
}

export type Camera = { x: number; y: number; scale: number };

const MAX_ZOOM = 1.7;
const MARGIN = 70;

/** The view that fits `rect` with some room around it, kept inside the page. */
function fit(rect: Rect, viewport: Timeline["viewport"]): Camera {
  const scale = clamp(
    Math.min(viewport.width / (rect.width + MARGIN * 2), viewport.height / (rect.height + MARGIN * 2)),
    1,
    MAX_ZOOM,
  );
  const halfW = viewport.width / scale / 2;
  const halfH = viewport.height / scale / 2;
  return {
    x: clamp(rect.x + rect.width / 2, halfW, viewport.width - halfW),
    y: clamp(rect.y + rect.height / 2, halfH, viewport.height - halfH),
    scale,
  };
}

/** The capture time `t` falls at this frame of the footage, if it plays at all. */
export function frameOf(all: readonly Segment[], t: number): number | null {
  const segment = all.find((s) => s.from <= t && t <= s.to);
  return segment ? segment.start + ((t - segment.from) / segment.speed) * FPS : null;
}

/** What the camera is framing at capture time `t`. */
export const focusAt = (timeline: Timeline, t: number): Rect | null =>
  // oxlint-disable-next-line unicorn/prefer-array-find -- the last match, not the first, and ES2022 has no findLast.
  timeline.focus.filter((f) => f.t - LEAD <= t).at(-1)?.rect ?? null;

/** How far into Waymark's shade the page is at `t`: 0 without, 1 with, easing between. */
export function shadeAt(timeline: Timeline, t: number): number {
  let level = 0;
  for (const change of timeline.shade) {
    if (change.t > t) break;
    const p = easeOut(clamp((t - change.t) / 0.15, 0, 1));
    level = change.on ? level + (1 - level) * p : level * (1 - p);
  }
  return level;
}

/** Starts a little before each focus, so the camera arrives as the popover does. */
const LEAD = 0.35;
const MOVE = 0.9;

/** Where the camera looks at capture time `t`: easing from one logged focus to the next. */
export function cameraAt(timeline: Timeline, t: number): Camera {
  const { viewport } = timeline;
  const whole: Camera = { x: viewport.width / 2, y: viewport.height / 2, scale: 1 };
  let camera = whole;
  for (const focus of timeline.focus) {
    const begin = focus.t - LEAD;
    if (t < begin) break;
    const target = fit(focus.rect, viewport);
    const p = easeInOut(clamp((t - begin) / MOVE, 0, 1));
    camera = {
      x: mix(camera.x, target.x, p),
      y: mix(camera.y, target.y, p),
      // In log space, so zooming in and out feel the same speed.
      scale: Math.exp(mix(Math.log(camera.scale), Math.log(target.scale), p)),
    };
  }
  return camera;
}
