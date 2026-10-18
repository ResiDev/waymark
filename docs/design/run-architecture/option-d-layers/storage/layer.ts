import { recordUnreadable, storageFailed } from "../problems";
import type { ReportProblem } from "../problems";
import type { Queue } from "../queue";
import type { Host, Layer } from "../run/layer";
import { loadFrom, saveTo } from "./adapter";
import type { StorageAdapter } from "./adapter";
import { changesBetween, EMPTY_READ, parseRecord, storedRecord } from "./records";
import type { Parsed, Read, StoredRecord } from "./records";

/*
 * The persistence layer: reads the record, hears it change elsewhere, and
 * saves each change. It owns the record's format and the order of a load; it
 * owns no state of the record's. Each slice's owner says how its part takes a
 * record from outside, and the core holds whether the record is in, since
 * every layer's commands wait on it. About 115 lines once filled in.
 */

/** What the persistence layer asks of the core. */
export type PersistenceHost = Pick<Host<Read>, "change" | "restore" | "hear" | "reconcile" | "runHeld">;

export type Persistence = Readonly<{
  layer: Layer<Read>;
  /** A record already in hand, as `RunOptions.initial`: taken in place of loading, before the server's moment. */
  take: (initial: StoredRecord) => void;
  /** Reads the adapter, after the server's moment. Nothing without an adapter. */
  load: () => void;
}>;

export type PersistenceOptions = Readonly<{
  adapter: StorageAdapter | undefined;
  onChange: ((stored: StoredRecord) => void) | undefined;
  queue: Queue;
  report: ReportProblem;
}>;

export function createPersistence(
  host: PersistenceHost,
  { adapter, onChange, queue, report }: PersistenceOptions,
): Persistence {
  /**
   * Two changes. The first takes the record, and saves nothing: storage
   * already holds it. The second works out what follows from it, such as
   * stale progress dropped, and saves that. Both are silent: the user did
   * none of it here.
   */
  const restore = (read: Parsed<Read> | "failed") => {
    host.change(
      (tx) => {
        if (read !== "failed" && read.ok) {
          host.restore(tx, read.value ?? EMPTY_READ);
          return;
        }
        if (read !== "failed") tx.problem(recordUnreadable(read.error));
        host.restore(tx, "unreadable");
      },
      { silent: true, persist: false },
    );
    host.change((tx) => host.reconcile(tx, "restored"), { silent: true });
  };

  /** A record saved elsewhere, such as in another tab: each slice takes what its rules say. */
  const hear = (value: unknown) => {
    const parsed = parseRecord(value);
    if (!parsed.ok) {
      report(recordUnreadable(parsed.error));
      return;
    }
    host.change((tx) => host.hear(tx, parsed.value ?? EMPTY_READ), { silent: true, persist: false });
    host.change((tx) => host.reconcile(tx, "heard"), { silent: true });
  };

  const loaded = (read: Parsed<Read> | "failed") => {
    try {
      restore(read);
      host.runHeld();
    } finally {
      adapter?.subscribe?.(hear);
    }
  };

  const layer: Layer<Read> = {
    /** Storage gets only what changed, so a save never writes over what this Run doesn't know. */
    persist: ({ before, after }) => {
      const changes = changesBetween(before.saved, after.saved);
      if (changes === undefined) return;
      if (adapter !== undefined) queue.invoke(() => saveTo(adapter, changes, (error) => report(storageFailed(error))));
      if (onChange !== undefined) {
        const stored = storedRecord(after.saved);
        queue.callApp("onChange", () => onChange(stored));
      }
    },
  };

  return {
    layer,
    take: (initial) => loaded(parseRecord(initial)),
    load: () => {
      if (adapter === undefined) return;
      loadFrom(
        adapter,
        (value) => loaded(parseRecord(value)),
        (error) => {
          try {
            report(storageFailed(error));
          } finally {
            loaded("failed");
          }
        },
      );
    },
  };
}
