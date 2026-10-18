import { applyChanges } from "./records";
import type { StoredChanges, StoredRecord } from "./records";

/**
 * Where the user's record is kept. Core checks whatever `load` and
 * `subscribe` hand back, so an adapter only moves values; it need not
 * validate them.
 */
export type StorageAdapter = Readonly<{
  load: () => StoredRecord | null | Promise<StoredRecord | null>;
  /**
   * Makes the changes to the stored record, leaving every entry they don't
   * name as it is: `applyChanges` does it. Core does not wait for it, and
   * reports a failure without retrying.
   */
  save: (changes: StoredChanges) => void | Promise<void>;
  /** Changes made elsewhere, such as in another tab. Returns an unsubscribe. */
  subscribe?: (listener: (record: StoredRecord | null) => void) => () => void;
}>;

type Report = (error: unknown) => void;

const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";

/**
 * Calls `onValue` before returning when the adapter answers synchronously. A
 * throw from `onValue` is not a storage failure, so it is left to propagate.
 */
export function loadFrom(
  adapter: StorageAdapter,
  onValue: (value: unknown) => void,
  fail: Report,
): void {
  let value: unknown;
  try {
    value = adapter.load();
  } catch (error) {
    fail(error);
    return;
  }
  if (isPromise(value)) value.then(onValue, fail);
  else onValue(value);
}

export function saveTo(adapter: StorageAdapter, changes: StoredChanges, fail: Report): void {
  try {
    const saved = adapter.save(changes);
    if (isPromise(saved)) saved.then(undefined, fail);
  } catch (error) {
    fail(error);
  }
}

const parse = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Handed on as is: core reports it as a record it cannot read.
    return text;
  }
};

/** A localStorage key stands for the adapter that keeps the record under it. */
export const adapterOf = (storage: string | StorageAdapter): StorageAdapter =>
  typeof storage === "string" ? localStorageAdapter(storage) : storage;

/**
 * Keeps the record in localStorage under `name`, and hears other tabs change
 * it. Outside a browser it stores nothing.
 */
export function localStorageAdapter(name: string): StorageAdapter {
  // Not `typeof localStorage`: where storage is blocked, reading it throws, and
  // that belongs in `load` and `save`, where core reports it.
  if (typeof window === "undefined") {
    return { load: () => null, save: () => {} };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it reads.
  const read = () => parse(localStorage.getItem(name)) as StoredRecord | null;
  return {
    load: read,
    // Read and written in one go, so the changes land on what another tab saved last.
    save: (changes) => {
      const next = applyChanges(parse(localStorage.getItem(name)), changes);
      if (next === null) localStorage.removeItem(name);
      else localStorage.setItem(name, JSON.stringify(next));
    },
    subscribe: (listener) => {
      const onStorage = (event: StorageEvent) => {
        // A null key is `localStorage.clear()` in another tab.
        if (event.storageArea !== localStorage) return;
        // What is stored now, not the event's value: this tab may have saved since the other tab did.
        if (event.key === name || event.key === null) listener(read());
      };
      globalThis.addEventListener("storage", onStorage);
      return () => globalThis.removeEventListener("storage", onStorage);
    },
  };
}
