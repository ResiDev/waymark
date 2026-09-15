import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createRun } from "./run";
import { defineWalkthrough } from "./walkthrough";
import type { Run, Running, Step } from "./types";

/**
 * Real-browser checks on the Run: real layout, real scrolling, real pointer
 * coordinates and real time. Everything else lives in run.test.ts under jsdom.
 */

let stop: (() => void) | undefined;

const running = <TStep extends Step>(run: Run<TStep>) => {
  const snapshot = run.getSnapshot();
  if (snapshot.phase !== "running") throw new Error(`Run is ${snapshot.phase}.`);
  return snapshot as Running<TStep>;
};

const foundRect = (run: Run) => {
  const { waymark } = running(run);
  if (waymark.status !== "found") throw new Error(`Waymark is ${waymark.status}.`);
  return waymark.rect;
};

const domRect = (element: Element) => {
  const { x, y, top, right, bottom, left, width, height } = element.getBoundingClientRect();
  return { x, y, top, right, bottom, left, width, height };
};

/** Start a Run and keep it watching until the test ends. */
const start = <const TStep extends Step>(steps: readonly TStep[], waymarkPadding?: number) => {
  const run = createRun(
    defineWalkthrough(steps),
    waymarkPadding === undefined ? {} : { waymarkPadding },
  );
  stop = run.subscribe(() => {});
  return run;
};

const settledScrollY = async () => {
  let last = -1;
  await expect
    .poll(() => {
      const same = window.scrollY === last;
      last = window.scrollY;
      return same;
    }, { interval: 100 })
    .toBe(true);
  return last;
};

beforeEach(() => {
  document.body.innerHTML = `
    <main style="padding: 40px">
      <button data-waymark="save" style="display:block; padding: 8px 12px">Save</button>
      <input data-waymark="name" style="display:block; margin-top: 8px; padding: 8px 12px" />
      <div style="height: 3000px"></div>
      <button data-waymark="footer" style="display:block; padding: 8px 12px">Footer</button>
    </main>`;
  window.scrollTo({ top: 0, behavior: "instant" });
});

afterEach(() => {
  stop?.();
  stop = undefined;
});

const el = (waymark: string) => document.querySelector(`[data-waymark="${waymark}"]`) as HTMLElement;

describe("layout", () => {
  it("locates a waymark at its real position and follows a layout change", async () => {
    const run = start([{ waymark: "save" }]);
    await expect.poll(() => running(run).waymark.status).toBe("found");
    expect(foundRect(run)).toEqual(domRect(el("save")));

    el("save").style.marginTop = "120px";
    await expect.poll(() => foundRect(run)).toEqual(domRect(el("save")));
  });

  it("scrolls an off-screen waymark into view once", async () => {
    start([{ waymark: "footer" }]);
    await expect.poll(() => window.scrollY).toBeGreaterThan(0);
    expect(await settledScrollY()).toBeGreaterThan(0);
    await expect.element(page.getByText("Footer")).toBeInViewport();

    // "once": scrolling back up must not pull the page down again.
    window.scrollTo({ top: 0, behavior: "instant" });
    expect(await settledScrollY()).toBe(0);
  });
});

describe("pointer", () => {
  it("a click on the waymark advances a click-gated step; a click away collapses", async () => {
    const run = start([{ waymark: "save", advance: "click" }, {}]);
    await expect.poll(() => running(run).canAdvance).toBe(false);

    await page.getByText("Save").click();
    await expect.poll(() => run.getSnapshot().stepIndex).toBe(1);

    await page.getByRole("main").click({ position: { x: 600, y: 20 } });
    await expect.poll(() => running(run).collapsed).toBe(true);
  });

  it("a click inside the halo padding counts as a waymark click", async () => {
    const run = start([{ waymark: "save", advance: "click" }, {}], 12);
    await expect.poll(() => running(run).waymark.status).toBe("found");
    const rect = domRect(el("save"));

    // Position is relative to the clicked element; main starts at the page origin.
    await page.getByRole("main").click({ position: { x: rect.right + 6, y: rect.bottom + 6 } });
    await expect.poll(() => run.getSnapshot().stepIndex).toBe(1);
  });
});

describe("time", () => {
  it("a state condition with delayMs must hold for real time before advancing", async () => {
    const run = start([
      {
        waymark: "name",
        advance: {
          when: { state: (e) => e instanceof HTMLInputElement && e.value.length >= 3 },
          delayMs: 300,
        },
      },
      {},
    ]);
    await page.getByRole("textbox").fill("abc");

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(run.getSnapshot().stepIndex).toBe(0);
    await expect.poll(() => run.getSnapshot().stepIndex, { timeout: 1_000 }).toBe(1);
  });
});
