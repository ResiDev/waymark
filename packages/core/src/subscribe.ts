import type { Queue } from "./queue";

export const listen =
  <T>(queue: Queue, listeners: Set<(snapshot: T) => void>, getSnapshot: () => T) =>
  (listener: (snapshot: T) => void): (() => void) => {
    listeners.add(listener);
    try {
      queue.now(() => queue.callApp("subscriber", () => listener(getSnapshot())));
    } catch (error) {
      listeners.delete(listener);
      throw error;
    }
    return () => {
      listeners.delete(listener);
    };
  };
