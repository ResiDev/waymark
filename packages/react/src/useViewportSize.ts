import { useSyncExternalStore } from "react";
import type { Size } from "./placement";

let snapshot: Size | undefined;

const getSnapshot = (): Size => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // External-store snapshots must keep their identity while their dimensions stay the same.
  if (snapshot === undefined || snapshot.width !== width || snapshot.height !== height) {
    snapshot = { width, height };
  }
  return snapshot;
};

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};

export const useViewportSize = (): Size => useSyncExternalStore(subscribe, getSnapshot);
