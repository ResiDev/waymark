import { storageFailed } from "../problems";
import type { ReportProblem } from "../problems";
import type { Queue } from "../queue";
import { isPromise, loadFrom } from "./adapter";
import type { SaveAdapter, SavePartialAdapter, StorageAdapter } from "./adapter";
import { combine, isRecordUnreadable, merge, parseRecord, RecordUnreadableError } from "./records";
import type { Parsed, RecordChanges, StoredRecord } from "./records";

export type Link = Readonly<{
  connect: () => () => void;
  /**
   * Only what changed, so a save never writes over what this Run doesn't
   * know: a `savePartial` adapter gets it as it is, and a `save` adapter the
   * stored record with it made.
   */
  save: (changes: RecordChanges) => void;
}>;

const isPartial = (adapter: StorageAdapter): adapter is SavePartialAdapter => adapter.savePartial !== undefined;

/** Runs `work`, then `next` with what it gave, synchronously unless it gave a promise. A throw or a rejection goes to `fail`. */
const attempt = <T>(work: () => T | PromiseLike<T>, next: (value: T) => void, fail: (error: unknown) => void) => {
  let value: T | PromiseLike<T>;
  try {
    value = work();
  } catch (error) {
    fail(error);
    return;
  }
  if (isPromise(value)) value.then(next, fail);
  else next(value);
};

export function createLink({
  adapter,
  queue,
  report,
  hasInitial,
  loaded,
  heard,
  refused,
}: Readonly<{
  adapter: StorageAdapter | undefined;
  queue: Queue;
  report: ReportProblem<never>;
  hasInitial: boolean;
  loaded: (read: Parsed | "failed") => void;
  heard: (value: unknown) => void;
  refused: (error: RecordUnreadableError) => void;
}>): Link {
  let connections = 0;
  let asked = hasInitial;
  // Storage is read only once connected, in the browser; a `save` adapter's save reads first.
  let everConnected = false;
  let unsubscribe: (() => void) | undefined;
  // While the load at connect is out, the latest record heard, applied once the load is in: on the
  // record, not on none, and after it. Each is the whole stored record, so the latest is enough.
  let awaitingLoad = false;
  let held: Readonly<{ value: unknown }> | undefined;

  // From connect, before the load is sent, so a write the load misses is still heard.
  const listen = () => {
    if (adapter?.subscribe === undefined || unsubscribe !== undefined) return;
    unsubscribe = adapter.subscribe((value) => {
      if (awaitingLoad) held = { value };
      else heard(value);
    });
  };

  // A write both in the load and in the record held is made twice; the second changes nothing.
  const take = (read: Parsed | "failed") => {
    try {
      loaded(read);
    } finally {
      awaitingLoad = false;
      const latest = held;
      held = undefined;
      if (latest !== undefined) heard(latest.value);
    }
  };

  const connect = () => {
    connections += 1;
    everConnected = true;
    const toLoad = asked ? undefined : adapter;
    if (toLoad !== undefined) {
      asked = true;
      awaitingLoad = true;
    }
    try {
      listen();
    } finally {
      // Sent even when subscribe throws, or the Run would wait on it for good.
      if (toLoad !== undefined) {
        loadFrom({
          adapter: toLoad,
          onValue: (value) => take(parseRecord(value)),
          fail: (error) => {
            try {
              report(storageFailed(error));
            } finally {
              take("failed");
            }
          },
        });
      }
    }
    if (adapter !== undefined && !isPartial(adapter)) flush(adapter);
    let connected = true;
    return () => {
      if (!connected) return;
      connected = false;
      connections -= 1;
      if (connections > 0) return;
      unsubscribe?.();
      unsubscribe = undefined;
      held = undefined;
    };
  };

  const failed = (error: unknown) => {
    if (isRecordUnreadable(error)) refused(error);
    else report(storageFailed(error));
  };

  // A `save` adapter's changes not saved yet, and whether a save is under way.
  // One at a time, so a save's load sees the one before it.
  let pending: RecordChanges | undefined;
  let saving = false;

  /** Loads what is stored, makes the pending changes to it and saves the whole. Synchronous end to end when the adapter is. */
  const flush = (whole: SaveAdapter) => {
    if (saving || pending === undefined || !everConnected) return;
    const sending = pending;
    pending = undefined;
    saving = true;
    const fail = (error: unknown) => {
      // Kept for the next save, under whatever changed since.
      pending = pending === undefined ? sending : combine(sending, pending);
      saving = false;
      failed(error);
    };
    const store = (record: StoredRecord | null) =>
      attempt(
        () => whole.save(record),
        () => {
          saving = false;
          flush(whole);
        },
        fail,
      );
    // The app's record in place of one Waymark could not read: nothing to load.
    if (sending.replace === true) {
      store(merge(null, sending));
      return;
    }
    attempt(
      () => whole.load(),
      (value) => {
        const parsed = parseRecord(value);
        if (parsed.ok) store(merge(parsed.value, sending));
        else fail(new RecordUnreadableError(`Waymark did not save over a record it cannot read. ${parsed.error.message}`, value));
      },
      fail,
    );
  };

  const save = (changes: RecordChanges) => {
    if (adapter === undefined) return;
    if (isPartial(adapter)) {
      attempt(() => adapter.savePartial(changes), () => {}, failed);
      return;
    }
    pending = pending === undefined ? changes : combine(pending, changes);
    flush(adapter);
  };

  return { connect, save: (changes) => queue.invoke(() => save(changes)) };
}
