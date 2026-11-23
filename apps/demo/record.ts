import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, preview } from "vite";

/**
 * Records the demo app for the promo video.
 *
 * Builds the app, drives it through the storyboard in Chromium at 1280×800 and
 * 2× scale, and screenshots it as fast as Chromium allows, keeping each frame with its timestamp.
 * ffmpeg turns those into a constant 60 fps video. Beside it goes a timeline:
 * when each beat starts and ends, what to frame, and where the pointer was, so
 * the edit can sync zooms, captions and a drawn cursor.
 *
 *   pnpm --filter demo record
 *
 * Writes video/public/capture.mp4 and video/public/capture.json, and keeps the
 * raw frames in .capture/frames.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 2;
const FPS = 60;
const FRAMES = here(".capture/frames");
const PUBLIC = here("video/public");

type Rect = { x: number; y: number; width: number; height: number };
type Beat = { id: string; start: number; end: number };

const clock = () => Date.now() / 1000;

declare global {
  interface Window {
    /** Put on the page by this script, so it hears Waymark's shade come and go. */
    shaded?: (on: boolean) => void;
  }
}

// ---- the app ----

await build({ configFile: here("vite.config.ts"), build: { outDir: here(".capture/dist"), emptyOutDir: true } });
// Any free port: a preview left running elsewhere shouldn't stop a recording.
const server = await preview({ configFile: here("vite.config.ts"), build: { outDir: here(".capture/dist") }, preview: { strictPort: false } });
const url = server.resolvedUrls?.local[0] ?? "http://localhost:4181/";

// ---- the browser and the capture ----

// CHROMIUM_PATH runs an installed Chromium instead of Playwright's own, where that can't be downloaded.
const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
const page = await context.newPage();
page.on("pageerror", (error) => console.error("page error:", error.message));

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

const frames: { file: string; t: number }[] = [];
const writes: Promise<void>[] = [];
// Screenshots, not Page.startScreencast: the screencast sends frames at CSS-pixel size whatever the device
// scale, so the footage came out at half size and blurred when the edit zoomed in. Playwright's screenshot
// takes every device pixel, and waits out a reload where a raw CDP one never returns.
const stop = new AbortController();
let capture = Promise.resolve();
async function shoot() {
  while (!stop.signal.aborted) {
    const before = clock();
    // oxlint-disable-next-line eslint/no-await-in-loop -- one shot at a time, each stamped as it's taken.
    const data = await page.screenshot({ type: "jpeg", quality: 92, scale: "device", caret: "initial" }).catch(() => null);
    // A shot that fails mid-reload is dropped; the last frame holds until the next.
    if (data === null) continue;
    const file = `${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({ file, t: (before + clock()) / 2 });
    writes.push(writeFile(`${FRAMES}/${file}`, data));
  }
}
const startCapture = () => {
  capture = shoot();
};

// ---- what the edit needs to know ----

const beats: Beat[] = [];
const focus: { t: number; rect: Rect }[] = [];
const pointer: { t: number; x: number; y: number }[] = [];
const clicks: { t: number; x: number; y: number }[] = [];
const reloads: { t: number }[] = [];
/** What the app sent to analytics, for the edit to show. */
const events: { t: number; name: string; detail: string }[] = [];
/** When Waymark's shade comes and goes, so the edit's text can sit on the same grey. */
const shade: { t: number; on: boolean }[] = [];

let open: { id: string; start: number } | null = null;
const beat = (id: string) => {
  if (open) beats.push({ ...open, end: clock() });
  open = id === "" ? null : { id, start: clock() };
  console.log(id === "" ? "  · cut" : `beat: ${id}`);
};

const pause = (ms: number) => page.waitForTimeout(ms);
// The storyboard's holds, scaled together: shorter makes a quicker cut, but each caption has less time to read.
const HOLD = 2 / 3;
const hold = (ms: number) => pause(Math.round(ms * HOLD));

let at = { x: 760, y: 520 };
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/** A person's move: eased, about a frame a step, and logged so the edit can draw it. */
async function moveTo(x: number, y: number, ms = 650) {
  const from = at;
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = ease(i / steps);
    at = { x: from.x + (x - from.x) * p, y: from.y + (y - from.y) * p };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step is a moment in time, so they must run in turn.
    await page.mouse.move(at.x, at.y);
    pointer.push({ t: clock(), ...at });
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above.
    await pause(16);
  }
}

const centre = async (selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Nothing to point at: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

async function click(selector: string, { ms = 650, dx = 0, dy = 0 } = {}) {
  const { x, y } = await centre(selector);
  await moveTo(x + dx, y + dy, ms);
  await pause(140);
  clicks.push({ t: clock(), ...at });
  await page.mouse.down();
  await pause(70);
  await page.mouse.up();
}

const union = (rects: Rect[]): Rect => {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Frames what matters now: the popover or beacon, the Waymark, and anything else named. */
async function frame(...selectors: string[]) {
  const all = ['[role="dialog"]', 'button[aria-label="Resume walkthrough"]', ...selectors];
  const boxes = await Promise.all(
    all.map(async (selector) => Promise.all((await page.locator(selector).all()).map((l) => l.boundingBox()))),
  );
  focus.push({ t: clock(), rect: union(boxes.flat().filter((box) => box !== null)) });
}

const popover = (text: string) => page.getByRole("dialog").filter({ hasText: text }).waitFor();

// ---- the storyboard ----

// A new context, so storage starts empty and the tour shows.
await page.exposeFunction("track", (event: { name: string; detail: string }) => {
  events.push({ t: clock(), ...event });
});
await page.exposeFunction("shaded", (on: boolean) => {
  shade.push({ t: clock(), on });
});
// Before the app's own scripts, and again after the reload.
await page.addInitScript(() => {
  let last = false;
  new MutationObserver(() => {
    const on = document.querySelector("[data-waymark-shade]") !== null;
    if (on === last) return;
    last = on;
    window.shaded?.(on);
  }).observe(document, { childList: true, subtree: true });
});
await page.mouse.move(at.x, at.y);
await page.goto(url);
await page.locator("table").waitFor();
startCapture();
const start = clock();
pointer.push({ t: start, ...at });
await hold(200);

// Each beat is one line of the captions, held long enough to read it, so the
// edit never has to slow the footage down.

// ---- act 1: steps that wait for the user ----

// "This step will automatically progress as soon as the user clicks Invite." It stays up as the tour
// moves on, which shows what it says.
beat("a1-title");
await popover("better with your team");
await frame('[data-waymark="invite"]');
await hold(1400);
await click('[data-waymark="invite"]', { ms: 600 });

beat("a1-click");
await popover("teammate's email");
await frame(".invite-panel");
await hold(1000);

// "This one unlocks Next once a valid email is entered, and the user moves on." A beat on the unlocked
// button before pressing it, so the change from locked shows.
beat("a1-state");
await click('[data-waymark="invite-email"]', { ms: 600, dx: -60 });
await hold(1000);
await page.keyboard.type("elena@fernhill.studio", { delay: 90 });
await page.getByRole("dialog").getByRole("button", { name: "Next", disabled: false }).waitFor();
await hold(900);
await click('[role="dialog"] button:text-is("Next")', { ms: 600 });

// "And now sending the invite will automatically complete the tour." Sending is also what ticks the
// checklist in act 3.
beat("a1-done");
await popover("send it");
await frame(".invite-panel");
await hold(1800);

// Then a breath before act 2.
beat("a1-send");
await click('[data-waymark="send-invite"]', { ms: 600 });
await page.getByRole("dialog").waitFor({ state: "detached" });
await page.locator(".invite-panel").waitFor({ state: "detached" });
await hold(2000);

// ---- act 2: started by the app, kept through a reload, paused, skipped, all of it tracked ----

// "Tours can be started automatically too — such as a user opening their own projects." One camera move.
beat("a2-title");
await frame(".projects", '[data-waymark="tabs"]');
await hold(800);
await click('[data-waymark="tabs"] button:has-text("Mine")', { ms: 1000 });
await popover("only the ones you own");
await hold(5000);

// "Even an accidental reload keeps the tour on the same step." Nothing but the stored run brings it back:
// the app only starts it on a click of Mine.
beat("a2-reload");
reloads.push({ t: clock() });
await page.reload();
await page.locator("table").waitFor();
await popover("only the ones you own");
await hold(5200);

// "Clicking anywhere else pauses the tour and hides the popover." Somewhere in shot, so the click is seen.
beat("a2-away");
await click("tbody tr:first-child td:nth-child(3)", { ms: 900 });
await page.getByRole("button", { name: "Resume walkthrough" }).waitFor();
await hold(2700);

// "A pulsing dot attaches to the last step. Clicking it reopens the tour, allowing the user to move at
// their own pace." The click it describes happens under it.
beat("a2-beacon");
await frame('[data-waymark="tabs"]');
await hold(4800);
await click('button[aria-label="Resume walkthrough"]', { ms: 1000 });
await popover("only the ones you own");
await hold(2000);

// "Waymark reports every start, pause, resume and skip, ready for your analytics." The card fills in
// first; the skip lands live. Then a breath before act 3.
beat("a2-skip");
await hold(1500);
await click('[role="dialog"] button:has-text("Skip")', { ms: 900 });
await page.getByRole("dialog").waitFor({ state: "detached" });
await hold(4200);

// Back to every project between the acts: act 3's new project has no owner yet.
beat("");
await click('[data-waymark="tabs"] button:has-text("All")', { ms: 500 });
await hold(300);

// ---- act 3: a checklist, ticked by a tour and by the user on their own ----

// "The checklist lays out what to learn. Users decide when."
beat("a3-title");
await frame(".getting-started");
await hold(3000);
// The cursor heads for the item while the line is still up; the next line comes with the click.
const pick = await centre('.tasks li:has-text("Create a new project") button');
await moveTo(pick.x, pick.y, 1200);

// "Each item has its own short tour, which runs only when the user asks."
beat("a3-pick");
await click('.tasks li:has-text("Create a new project") button', { ms: 120 });
await popover("Every project starts here");
await frame(".getting-started", '[data-waymark="new-project"]');
await hold(3200);

beat("a3-tour");
await click('[data-waymark="new-project"]', { ms: 700 });
await popover("Give it a name");
await frame(".new-project", ".getting-started");
await click('[data-waymark="project-name"]', { ms: 500, dx: -60 });
await page.keyboard.type("Spring launch", { delay: 55 });
await popover("And create it");
await hold(600);

// "Finishing the tour ticks the item off." A beat with it still open, then the click that ticks it.
beat("a3-tick");
await frame('[data-waymark="create-project"]', ".getting-started");
await hold(1100);
await click('[data-waymark="create-project"]', { ms: 600 });
await page.getByRole("dialog").waitFor({ state: "detached" });
await hold(1300);

// "Doing the task without the tour ticks it off too."
beat("a3-owner");
await frame("tbody tr:first-child");
await hold(500);
await click('[data-waymark="assign-owner"]', { ms: 1100 });
await page.locator(".owner-menu").waitFor();

beat("a3-auto");
await frame(".owner-menu", ".getting-started");
await hold(1100);
await click('.owner-menu button:has-text("Hannah")', { ms: 600 });
await hold(1800);
beat("");

const end = clock();
stop.abort();
await capture;
await Promise.all(writes);
await browser.close();
await server.close();

// ---- frames to a constant-rate video ----

const kept = frames.filter((f) => f.t >= start);
const first = kept[0];
if (!first) throw new Error("The capture took no frames.");
const list = kept
  .map((f, i) => `file '${f.file}'\nduration ${((kept[i + 1]?.t ?? end) - f.t).toFixed(4)}`)
  .join("\n");
await writeFile(`${FRAMES}/frames.txt`, `${list}\nfile '${kept.at(-1)!.file}'\n`);
execFileSync(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt",
   "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "14",
   "-movflags", "+faststart", `${PUBLIC}/capture.mp4`],
  { cwd: FRAMES, stdio: "inherit" },
);

const since = (t: number) => Math.round((t - first.t) * 1000) / 1000;
const timeline = {
  viewport: VIEWPORT,
  scale: SCALE,
  fps: FPS,
  duration: since(end),
  beats: beats.map((b) => ({ id: b.id, start: since(b.start), end: since(b.end) })),
  focus: focus.map((f) => ({ t: since(f.t), rect: f.rect })),
  pointer: pointer.map((p) => ({ t: since(p.t), x: Math.round(p.x), y: Math.round(p.y) })),
  clicks: clicks.map((c) => ({ t: since(c.t), x: Math.round(c.x), y: Math.round(c.y) })),
  reloads: reloads.map((r) => ({ t: since(r.t) })),
  events: events.map((e) => ({ t: since(e.t), name: e.name, detail: e.detail })),
  shade: shade.map((s) => ({ t: since(s.t), on: s.on })),
};
await writeFile(`${PUBLIC}/capture.json`, `${JSON.stringify(timeline, null, 2)}\n`);

const seconds = kept.at(-1)!.t - first.t;
console.log(`${kept.length} frames over ${seconds.toFixed(1)}s (${(kept.length / seconds).toFixed(0)} fps average)`);
console.log(`→ ${PUBLIC}/capture.mp4, capture.json`);
