import { describe, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import { createRun } from "./run";
import { addPage } from "../test/browser";
import { defineWalkthrough } from "../walkthrough/walkthrough";
import type { Run } from "./types";
import type { ExactStep, Step } from "../walkthrough/types";


const running = <TStep extends Step>(run: Run<TStep>) => {
  const snapshot = run.getSnapshot();
  if (snapshot.phase !== "running") throw new Error(`Run is ${snapshot.phase}.`);
  return snapshot;
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

/** Starts a Run on the page, watched until the test ends. */
const start = <const TStep extends Step>(steps: readonly TStep[], waymarkPadding?: number): Run<TStep> => {
  addPage();
  const run = createRun(
    defineWalkthrough<TStep>(steps as readonly TStep[] & readonly ExactStep<TStep, Step>[]),
    waymarkPadding === undefined ? {} : { waymarkPadding },
  );
  onTestFinished(run.subscribe(() => {}));
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
    await expect.poll(() => running(run).stepIndex).toBe(1);

    await page.getByRole("main").click({ position: { x: 600, y: 20 } });
    await expect.poll(() => running(run).collapsed).toBe(true);
  });

  it("a click inside the halo padding counts as a waymark click", async () => {
    const run = start([{ waymark: "save", advance: "click" }, {}], 12);
    await expect.poll(() => running(run).waymark.status).toBe("found");
    const rect = domRect(el("save"));

    // Position is relative to the clicked element; main starts at the page origin.
    await page.getByRole("main").click({ position: { x: rect.right + 6, y: rect.bottom + 6 } });
    await expect.poll(() => running(run).stepIndex).toBe(1);
  });
});

describe("time", () => {
  it("a state condition with delayMs must hold for real time before advancing", async () => {
    const run = start([
      {
        waymark: "name",
        advance: {
          state: (e) => e instanceof HTMLInputElement && e.value.length >= 3,
          delayMs: 300,
        },
      },
      {},
    ]);
    await page.getByRole("textbox").fill("abc");

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(running(run).stepIndex).toBe(0);
    await expect.poll(() => running(run).stepIndex, { timeout: 1_000 }).toBe(1);
  });
});
