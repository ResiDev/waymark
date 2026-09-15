import { afterAll, beforeAll, expect, it } from "vitest";
import { createRun } from "./run";
import { defineWalkthrough } from "./walkthrough";

/**
 * What one frame of a Run costs, and how much of it is the browser.
 *
 * requestAnimationFrame is stubbed so the frame callback can be called in a
 * tight loop. Each figure is the median of several timed batches, per
 * iteration, in nanoseconds. Run with `pnpm test:perf`; this never gates a check.
 */

const BATCH_MS = 100;
const MAX_BATCH = 200_000;
const REPS = 7;

/**
 * Median per-iteration cost of `fn`, in ns. The batch size is calibrated so
 * one batch takes about BATCH_MS, which also serves as the warm-up.
 */
const measure = (fn: (i: number) => void): number => {
  let batch = 1_000;
  for (;;) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) fn(i);
    const ms = performance.now() - t0;
    if (ms >= BATCH_MS || batch >= MAX_BATCH) break;
    batch = Math.min(MAX_BATCH, Math.ceil((batch * BATCH_MS) / Math.max(ms, 1)));
  }
  const samples: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) fn(i);
    samples.push(((performance.now() - t0) * 1e6) / batch);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(REPS / 2)]!;
};

let captured: FrameRequestCallback | undefined;
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

beforeAll(() => {
  globalThis.requestAnimationFrame = (cb) => {
    captured = cb;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  document.body.innerHTML = `
    <main style="padding: 40px">
      <button data-waymark="save" style="display:block; padding: 8px 12px">Save</button>
      <div style="height: 3000px"></div>
    </main>`;
});

afterAll(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
});

/** Starts a Run under the stubbed rAF and returns a function that runs one frame. */
const frameOf = (steps: Parameters<typeof defineWalkthrough>[0]) => {
  const run = createRun(defineWalkthrough(steps));
  const stop = run.subscribe(() => {});
  const frame = () => {
    const cb = captured!;
    captured = undefined;
    cb(performance.now());
  };
  frame();
  return { frame, stop, run };
};

const ns = (n: number) => `${n.toFixed(0).padStart(6)} ns`;
const row = (label: string, n: number, note = "") =>
  `${label.padEnd(34)} ${ns(n)}  ${note}`;

it("measures a frame against the browser primitives", () => {
  const el = document.querySelector<HTMLElement>('[data-waymark="save"]')!;
  let sink = 0;

  // ---- primitives ----------------------------------------------------------
  const gbcr = measure(() => { sink += el.getBoundingClientRect().top; });
  const viewport = measure(() => { sink += innerHeight + innerWidth; });
  const now = measure(() => { sink += performance.now(); });
  const query = measure(() => { sink += document.querySelector('[data-waymark="save"]') ? 1 : 0; });
  const transform = measure((i) => { el.style.transform = `translateY(${i % 10}px)`; });
  const transformGbcr = measure((i) => {
    el.style.transform = `translateY(${i % 10}px)`;
    sink += el.getBoundingClientRect().top;
  });
  el.style.transform = "";
  const dirtyGbcr = measure((i) => {
    el.style.paddingLeft = `${12 + (i % 2)}px`;
    sink += el.getBoundingClientRect().top;
  });
  el.style.paddingLeft = "";

  // ---- the Run -------------------------------------------------------------
  const still = frameOf([{ waymark: "save" }]);
  const stillFrame = measure(still.frame);
  still.stop();

  const moving = frameOf([{ waymark: "save" }]);
  const movingFrame = measure((i) => {
    el.style.transform = `translateY(${i % 10}px)`;
    moving.frame();
  });
  moving.stop();
  el.style.transform = "";

  const dirty = frameOf([{ waymark: "save" }]);
  const dirtyFrame = measure((i) => {
    el.style.paddingLeft = `${12 + (i % 2)}px`;
    dirty.frame();
  });
  dirty.stop();
  el.style.paddingLeft = "";

  const checked = frameOf([{ waymark: "save", advance: { state: () => false } }]);
  const checkedFrame = measure(checked.frame);
  checked.stop();

  const stillCore = stillFrame - gbcr - viewport;
  const lines = [
    "",
    "primitives",
    row("getBoundingClientRect", gbcr),
    row("innerHeight + innerWidth", viewport),
    row("performance.now", now),
    row("querySelector (not used per frame)", query),
    row("set transform", transform),
    row("set transform + gBCR", transformGbcr),
    row("dirty layout + gBCR", dirtyGbcr),
    "",
    "one frame of a Run",
    row("still waymark", stillFrame, `core ≈ ${ns(stillCore)} (${((stillCore / stillFrame) * 100).toFixed(0)}%)`),
    row("moving waymark (transform)", movingFrame, `overhead vs bare ≈ ${ns(movingFrame - transformGbcr)}`),
    row("dirty layout", dirtyFrame, `overhead vs bare ≈ ${ns(dirtyFrame - dirtyGbcr)}`),
    row("still + state check", checkedFrame, `check + now ≈ ${ns(checkedFrame - stillFrame)}`),
    row("step without waymark", 0, "no frame loop at all"),
    "",
  ];
  console.log(lines.join("\n"));

  expect(sink).not.toBeNaN();
  expect(stillFrame).toBeGreaterThan(0);
});
