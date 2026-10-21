import type { RecordChanges, StoredRecord } from "./records";

type MaybePromise<T> = T | Promise<T>;

/** Changes made elsewhere, such as in another tab. Returns an unsubscribe. */
type Subscribe = (listener: (record: StoredRecord | null) => void) => () => void;

/** An adapter that keeps the whole record: `save` gets it, to store as it is. */
export type SaveAdapter = Readonly<{
  /**
   * What is stored, or `null` when nothing is. A load that fails throws or
   * rejects: `null` says the user has no record, and the next save then holds
   * only this Run's progress. Called when the Run connects, and again before
   * every save.
   */
  load: () => StoredRecord | null | Promise<StoredRecord | null>;
  /**
   * Keeps `record` in place of whatever is stored. It is whole: what `load`
   * just answered, with this Run's changes made to it, so entries another tab
   * saved since are kept. `null` once nothing is left: store null, or delete.
   *
   * Not called when the load before it fails, or answers a record Waymark
   * cannot read, unless the app chose `replace` on the `recordUnreadable`
   * problem. One save runs at a time, and changes made meanwhile go in the
   * next. Core does not wait for it. A save that fails is reported, and its
   * changes go again with the next.
   */
  save: (record: StoredRecord | null) => MaybePromise<void>;
  subscribe?: Subscribe;
  savePartial?: never;
}>;

/** An adapter that makes only what changed to what is stored, usually on a server with `applyChanges`. */
export type SavePartialAdapter = Readonly<{
  /** What is stored, or `null` when nothing is. Called once, when the Run connects. */
  load: () => StoredRecord | null | Promise<StoredRecord | null>;
  /**
   * Makes `changes` to what is stored. Not a record: storing it as one loses
   * every entry it leaves out. Hand it to `applyChanges` with what is stored,
   * and store what that returns, in one transaction where two devices may
   * save at once. A `RecordUnreadableError` thrown here is reported as
   * `recordUnreadable`; anything else as `storageFailed`. Core does not wait
   * for it, and does not try again.
   */
  savePartial: (changes: RecordChanges) => MaybePromise<void>;
  subscribe?: Subscribe;
  save?: never;
}>;

/**
 * Where the user's record is kept: give `save` or `savePartial`, not both.
 * `save` gets the whole record, to store as it is. `savePartial` gets only
 * what changed, so each save is one small write without the load `save` needs
 * first, for code that merges it into what is stored. Core checks whatever
 * `load` and `subscribe` hand back, so an adapter only moves values.
 */
export type StorageAdapter = SaveAdapter | SavePartialAdapter;

type Report = (error: unknown) => void;

export const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";

/**
 * Calls `onValue` before returning when the adapter answers synchronously. A
 * throw from `onValue` is not a storage failure, so it is left to propagate.
 */
export function loadFrom({
  adapter,
  onValue,
  fail,
}: Readonly<{ adapter: StorageAdapter; onValue: (value: unknown) => void; fail: Report }>): void {
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
export const adapterOf = (storage: string | StorageAdapter): StorageAdapter => {
  if (typeof storage === "string") return localStorageAdapter(storage);
  // TypeScript refuses both and neither; this is for JavaScript, and for a cast.
  if ((storage.save === undefined) === (storage.savePartial === undefined)) {
    throw new Error("A storage adapter gives `save` or `savePartial`, not both and not neither.");
  }
  return storage;
};

/**
 * Keeps the record in localStorage under `name`, and hears other tabs change
 * it. localStorage is read only as the Run uses it, which is after it connects
 * in the browser, so making one on a server is safe.
 */
export function localStorageAdapter(name: string): SaveAdapter {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it reads.
  const read = () => parse(localStorage.getItem(name)) as StoredRecord | null;
  return {
    // Both synchronous, so core loads, makes its changes and saves in one go, and no other tab writes between.
    load: read,
    save: (record) => {
      if (record === null) localStorage.removeItem(name);
      else localStorage.setItem(name, JSON.stringify(record));
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
