import { act } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished } from "vitest";

/** An empty element in the body, removed when the test ends. */
export const addHost = () => {
  const host = document.body.appendChild(document.createElement("div"));
  onTestFinished(() => host.remove());
  return host;
};

/** A React root in a host of its own, unmounted in act and removed when the test ends. */
export const addRoot = () => {
  const host = addHost();
  const root = createRoot(host);
  onTestFinished(() => act(async () => root.unmount()));
  return { root, host };
};

const targetRect = {
  x: 20,
  y: 20,
  top: 20,
  left: 20,
  right: 120,
  bottom: 60,
  width: 100,
  height: 40,
  toJSON: () => ({}),
} as DOMRect;

/** A Waymark button at 100×40 on (20, 20), a rect jsdom can't lay out, ahead of any host in the body. */
export const addTarget = (waymark: string, label: string): HTMLButtonElement => {
  const target = document.createElement("button");
  target.dataset.waymark = waymark;
  target.textContent = label;
  target.getBoundingClientRect = () => targetRect;
  document.body.prepend(target);
  onTestFinished(() => target.remove());
  return target;
};

/** A localStorage key, removed again when the test ends. */
export const localKey = (key: string) => {
  onTestFinished(() => localStorage.removeItem(key));
  return key;
};
