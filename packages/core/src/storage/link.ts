import { storageFailed } from "../problems";
import type { ReportProblem } from "../problems";
import type { Queue } from "../queue";
import { loadFrom, saveTo } from "./adapter";
import type { StorageAdapter } from "./adapter";
import { isRecordUnreadable, parseRecord } from "./records";
import type { Parsed, RecordUnreadableError, StoredChanges } from "./records";

export type Link = Readonly<{
  connect: () => () => void;
  /** Only what changed, so a save never writes over what this Run doesn't know. */
  save: (changes: StoredChanges) => void;
}>;

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

  return {
    connect,
    save: (changes) => {
      if (adapter !== undefined) queue.invoke(() => saveTo({ adapter, changes, fail: failed }));
    },
  };
}
