/**
 * Where a record is kept. Core checks whatever `load` and `subscribe` hand
 * back, so an adapter only moves values; it need not validate them.
 */
export type StorageAdapter<T> = Readonly<{
  load: () => T | null | Promise<T | null>;
  // Methods, not properties, so `localStorageAdapter()`, which fits any record, can be declared apart from where it is used.
  /** `null` clears. Core does not wait for it, and reports a failure without retrying. */
  save(value: T | null): void | Promise<void>;
  /** Changes made elsewhere, such as in another tab. Returns an unsubscribe. */
  subscribe?(listener: (value: T | null) => void): () => void;
}>;

type Report = (error: unknown) => void;

const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";

/**
 * Calls `onValue` before returning when the adapter answers synchronously. A
 * throw from `onValue` is not a storage failure, so it is left to propagate.
 */
export function loadFrom<T>(
  adapter: StorageAdapter<T>,
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

export function saveTo<T>(adapter: StorageAdapter<T>, value: T | null, fail: Report): void {
  try {
    const saved = adapter.save(value);
    if (isPromise(saved)) saved.then(undefined, fail);
  } catch (error) {
    fail(error);
  }
}

/** Without a handler, a storage failure is logged rather than lost. */
export const reporter =
  (record: string, handle: Report | undefined): Report =>
  (error) => {
    if (handle) handle(error);
    else console.error(`Waymark could not use its ${record} storage.`, error);
  };

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
export const adapterOf = <T>(storage: string | StorageAdapter<T>): StorageAdapter<T> =>
  typeof storage === "string" ? localStorageAdapter<T>(storage) : storage;

/**
 * Keeps a record in localStorage under `name`, and hears other tabs change it.
 * Outside a browser it stores nothing. It fits any record: core checks what
 * it reads.
 */
export function localStorageAdapter<T = never>(name: string): StorageAdapter<T> {
  // Not `typeof localStorage`: where storage is blocked, reading it throws, and
  // that belongs in `load` and `save`, where core reports it.
  if (typeof window === "undefined") {
    return { load: () => null, save: () => {} };
  }
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it loads.
    load: () => parse(localStorage.getItem(name)) as T | null,
    save: (value) => {
      if (value === null) localStorage.removeItem(name);
      else localStorage.setItem(name, JSON.stringify(value));
    },
    subscribe: (listener) => {
      const onStorage = (event: StorageEvent) => {
        // A null key is `localStorage.clear()` in another tab.
        if (event.storageArea !== localStorage) return;
        if (event.key === name || event.key === null) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it hears.
          listener(parse(event.key === null ? null : event.newValue) as T | null);
        }
      };
      globalThis.addEventListener("storage", onStorage);
      return () => globalThis.removeEventListener("storage", onStorage);
    },
  };
}
