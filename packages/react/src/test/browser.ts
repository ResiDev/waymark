import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished } from "vitest";
import { commands, page } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    setReducedMotion: (reduce: boolean) => Promise<void>;
  }
}

/** Renders into a new element in the body, unmounted and removed when the test ends. */
export const render = (ui: ReactNode) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  root.render(ui);
  onTestFinished(() => {
    root.unmount();
    host.remove();
  });
  return host;
};

/**
 * A 100×40 Waymark button named "Page element", removed when the test ends. Fixed where `position`
 * says, unless it sets `position: "absolute"` to scroll with the page.
 */
export const addWaymark = (position: Partial<Record<"position" | "top" | "right" | "left", string>>) => {
  const waymark = document.createElement("button");
  waymark.type = "button";
  waymark.dataset.waymark = "target";
  waymark.textContent = "Page element";
  Object.assign(waymark.style, { position: "fixed", width: "100px", height: "40px", ...position });
  document.body.prepend(waymark);
  onTestFinished(() => waymark.remove());
  return waymark;
};

/** Resizes the viewport, then puts it back when the test ends. */
export const resize = async (width: number, height: number) => {
  onTestFinished(() => page.viewport(900, 600));
  await page.viewport(width, height);
};

/** Scrolls the window to `y`, and back to the top when the test ends. */
export const scrollPage = async (y: number) => {
  onTestFinished(() => window.scrollTo({ top: 0, behavior: "instant" }));
  window.scrollTo({ top: y, behavior: "instant" });
  await settle();
};

/** Lets the page animate until the test ends: browser tests run with reduced motion, so nothing is measured mid-entrance. */
export const allowMotion = async () => {
  onTestFinished(() => commands.setReducedMotion(true));
  await commands.setReducedMotion(false);
};

/** A few frames, for layout and the Walkthrough's measuring to catch up, on the browser's real clock. */
export const settle = async () => {
  for (let frame = 0; frame < 3; frame++) {
    // oxlint-disable-next-line no-await-in-loop -- consecutive frames let layout and React updates settle
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
};

/**
 * How far past each edge of the screen the element reaches, so a failure says which edge and by how much.
 * Rounded, as `offsetWidth` measures whole pixels: a fractionally wide element may poke out by part of one.
 */
export const pastEdges = (element: Element) => {
  const { top, right, bottom, left } = element.getBoundingClientRect();
  const past = (overflow: number) => Math.round(Math.max(0, overflow));
  return {
    top: past(-top),
    left: past(-left),
    bottom: past(bottom - window.innerHeight),
    right: past(right - window.innerWidth),
  };
};

/** What `pastEdges` gives for an element wholly on screen. */
export const onScreen = { top: 0, left: 0, bottom: 0, right: 0 };

/** The element's centre on screen. */
export const centre = (element: Element) => {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { x: left + width / 2, y: top + height / 2 };
};

/** Renders 100px down a 300px scrolling container, which is removed when the test ends. */
export const renderInScroller = (ui: ReactNode) => {
  const scroller = document.body.appendChild(document.createElement("div"));
  Object.assign(scroller.style, { height: "300px", overflow: "auto" });
  const host = scroller.appendChild(document.createElement("div"));
  Object.assign(host.style, { padding: "100px 0 1000px" });
  const root = createRoot(host);
  root.render(ui);
  onTestFinished(() => {
    root.unmount();
    scroller.remove();
  });
  return scroller;
};
