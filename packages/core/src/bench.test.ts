// Scratch benchmark: per-frame cost of v2 vs v3, same DOM, same step.
// jsdom's getBoundingClientRect is a cheap stub, so this measures OUR
// overhead only — which is the thing in question.
import { test } from "vitest";
import { createTour as createV2 } from "./v2/store2";
import { createTour as createV3 } from "./v3/tour";
import type { Config as ConfigV2 } from "./v2/types";
import type { Config as ConfigV3 } from "./v3/types";
import { createRun } from "./v5/run";
import { defineTutorial } from "./v5/tutorial";

const createV5 = (c: { root: Document; highlightPadding: number }) =>
  createRun(
    defineTutorial([{ waymark: "t", advance: { state: () => false } }]),
    { root: c.root, waymarkPadding: c.highlightPadding },
  );
import { createRun as createRunV6 } from "./v6/run";
import { createRun as createRunV7 } from "./v7/run";
import { defineTutorial as defineTutorialV7 } from "./v7/tutorial";

const createV7 = (c: { root: Document; highlightPadding: number }) =>
  createRunV7(
    defineTutorialV7([{ waymark: "t", advance: { state: () => false } }]),
    { root: c.root, waymarkPadding: c.highlightPadding },
  );

import { createRun as createRunV8 } from "./v8/run";
import { defineTutorial as defineTutorialV8 } from "./v8/tutorial";

const createV8 = (c: { root: Document; highlightPadding: number }) =>
  createRunV8(
    defineTutorialV8([{ waymark: "t", advance: { state: () => false } }]),
    { root: c.root, waymarkPadding: c.highlightPadding },
  );

const createV6 = (c: { root: Document; highlightPadding: number }) =>
  createRunV6(
    defineTutorial([{ waymark: "t", advance: { state: () => false } }]),
    { root: c.root, waymarkPadding: c.highlightPadding },
  );

const N = 200_000;

function setup(moving: boolean) {
  document.body.innerHTML = `<button data-waymark="t">x</button>`;
  const el = document.querySelector("button")!;
  let i = 0;
  // moving: rect differs every frame (scroll/animation). static: steady state.
  el.getBoundingClientRect = () =>
    ({ x: moving ? i++ : 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }) as DOMRect;
  const step = { waymark: "t", callbackArgs: undefined, advanceWhen: { type: "state" as const, check: () => false, gateNext: true } };
  const config = { getStep: () => step, root: document, tourCallbacks: {}, highlightPadding: 8 };
  return config as ConfigV2<undefined> & ConfigV3<undefined>;
}

// Drive frames synchronously: capture the rAF callback and call it ourselves.
let frame: FrameRequestCallback | null = null;
globalThis.requestAnimationFrame = (cb) => { frame = cb; return 1; };
globalThis.cancelAnimationFrame = () => {};

function run(label: string, make: (c: ConfigV2<undefined> & ConfigV3<undefined>) => { subscribe: (cb: () => void) => () => void; getSnapshot?: () => unknown }, moving: boolean) {
  const tour = make(setup(moving));
  let notified = 0;
  // Read on every notify, like useSyncExternalStore would — otherwise the
  // bench flatters lazy snapshot building and penalizes eager.
  const unsub = tour.subscribe(() => {
    notified++;
    tour.getSnapshot?.();
  });
  // warm up
  for (let i = 0; i < 20_000; i++) frame!(performance.now());
  notified = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) frame!(performance.now());
  const t1 = performance.now();
  unsub();
  const ns = ((t1 - t0) * 1e6) / N;
  console.log(`${label.padEnd(12)} ${moving ? "moving" : "static"}: ${ns.toFixed(0)} ns/frame  (${notified} notifies)`);
}

test("bench", () => {
  for (const moving of [false, true]) {
    for (let round = 0; round < 3; round++) {
      run("v2", createV2, moving);
      run("v3", createV3, moving);
      run("v5", createV5, moving);
      run("v6", createV6, moving);
      run("v7", createV7, moving);
      run("v8", createV8, moving);
    }
  }
});
