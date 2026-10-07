import { onTestFinished, vi } from "vitest";

/** Puts an element on the page until the test finishes. */
export const addToBody = <T extends Element>(element: T) => {
  document.body.append(element);
  onTestFinished(() => element.remove());
  return element;
};

/** A Waymark at a rect jsdom can't lay out, 100×40 at (20, 20) unless `rect` says otherwise. */
export const addTarget = (waymark: string, rect: Partial<DOMRect> = {}) => {
  const element = document.createElement("button");
  element.dataset["waymark"] = waymark;
  const box = {
    x: 20,
    y: 20,
    top: 20,
    left: 20,
    right: 120,
    bottom: 60,
    width: 100,
    height: 40,
    ...rect,
  } as DOMRect;
  element.getBoundingClientRect = () => box;
  return addToBody(element);
};

/** A target below jsdom's 768px viewport, with a stand-in for the scroll jsdom lacks. */
export const addFarTarget = (waymark: string) => {
  const element = addTarget(waymark, { y: 2000, top: 2000, bottom: 2040 });
  const scroll = vi.fn();
  element.scrollIntoView = scroll;
  return { element, scroll };
};

/** A localStorage key, removed again when the test ends. */
export const localKey = (key: string) => {
  onTestFinished(() => localStorage.removeItem(key));
  return key;
};
