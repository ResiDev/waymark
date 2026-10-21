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
  loading,
  loaded,
  heard,
  refused,
}: Readonly<{
  adapter: StorageAdapter | undefined;
  queue: Queue;
  report: ReportProblem<never>;
  hasInitial: boolean;
  loading: () => boolean;
  loaded: (read: Parsed | "failed") => void;
  heard: (value: unknown) => void;
  refused: (error: RecordUnreadableError) => void;
}>): Link {
  let connections = 0;
  let asked = hasInitial;
  // Storage is read only once connected, in the browser; a `save` adapter's save reads first.
  let everConnected = false;
  let unsubscribe: (() => void) | undefined;

  // Once the record is in, so a change heard lands on the record rather than on none.
  const hear = () => {
    if (adapter?.subscribe === undefined || unsubscribe !== undefined) return;
    if (connections === 0 || loading()) return;
    unsubscribe = adapter.subscribe(heard);
  };

  const take = (read: Parsed | "failed") => {
    try {
      loaded(read);
    } finally {
      hear();
    }
  };

  const connect = () => {
    connections += 1;
    everConnected = true;
    if (adapter !== undefined && !asked) {
      asked = true;
      loadFrom({
        adapter,
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
    hear();
    if (adapter !== undefined && !isPartial(adapter)) flush(adapter);
    let connected = true;
    return () => {
      if (!connected) return;
      connected = false;
      connections -= 1;
      if (connections > 0) return;
      unsubscribe?.();
      unsubscribe = undefined;
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
