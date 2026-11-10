import type { Queue } from "./queue";

export const listen =
  <T>(queue: Queue, listeners: Set<(snapshot: T) => void>, getSnapshot: () => T) =>
  (listener: (snapshot: T) => void): (() => void) => {
    listeners.add(listener);
    queue.now(() => {
      try {
        queue.callAppOrThrow("subscriber", () => listener(getSnapshot()));
      } catch (error) {
        // Dropped only for its own first call's throw: other work it set off, such as onEvent, keeps it.
        listeners.delete(listener);
        throw error;
      }
    });
    return () => {
      listeners.delete(listener);
    };
  };
