import type { Queue } from "./queue";

export const listen =
  <T>(queue: Queue, listeners: Set<(snapshot: T) => void>, getSnapshot: () => T) =>
  (listener: (snapshot: T) => void): (() => void) => {
    listeners.add(listener);
    // The listener's own first call threw, and the problem handler threw it back. Only then is
    // the listener dropped; a throw from other work its call set off, such as onEvent's, keeps it.
    let ownThrew = false;
    try {
      queue.now(() => {
        try {
          queue.callAppOrThrow("subscriber", () => listener(getSnapshot()));
        } catch (error) {
          ownThrew = true;
          throw error;
        }
      });
    } catch (error) {
      if (ownThrew) listeners.delete(listener);
      throw error;
    }
    return () => {
      listeners.delete(listener);
    };
  };
