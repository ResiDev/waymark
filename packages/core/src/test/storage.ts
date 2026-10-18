import { vi } from "vitest";
import type { StorageAdapter } from "../storage/adapter";
import { applyChanges } from "../storage/records";
import type { StoredChanges, StoredRecord } from "../storage/records";

/**
 * Storage in memory, as an adapter should keep it: `save` makes its changes
 * to what is held, and `stored()` reads it back. Given what Waymark cannot
 * read, every save fails.
 */
export function held(value: StoredRecord | null) {
  let stored: unknown = value;
  const adapter = {
    load: vi.fn(() => value),
    save: vi.fn((changes: StoredChanges) => {
      stored = applyChanges(stored, changes);
    }),
  } satisfies StorageAdapter;
  return Object.assign(adapter, { stored: () => stored });
}

/** Storage in memory whose `load` answers when the test says so. */
export function later(value: StoredRecord | null = null) {
  let stored: unknown = value;
  let answer: (value: StoredRecord | null) => void = () => {};
  let refuse: (error: unknown) => void = () => {};
  const adapter = {
    load: vi.fn(
      () =>
        new Promise<StoredRecord | null>((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    ),
    save: vi.fn((changes: StoredChanges) => {
      stored = applyChanges(stored, changes);
    }),
  } satisfies StorageAdapter;
  return {
    adapter,
    stored: () => stored,
    answer: async (given: StoredRecord | null = value) => {
      answer(given);
      await Promise.resolve();
    },
    refuse: async (error: unknown) => {
      refuse(error);
      await Promise.resolve();
    },
  };
}
