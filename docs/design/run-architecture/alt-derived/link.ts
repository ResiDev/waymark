// Sketch for packages/core/src/storage/link.ts, about 60 lines.
//
// Owns: LinkState, the Run's connection to storage. Storage is asked for the
// record once, by the first `run.connect()`, in the browser; other tabs are
// heard while a connection is open and the record is in; saves go out
// through the queue. Holds no fact about the record: what storage says goes
// to the Run, which makes it a change.
//
// Replaces run.ts's connect, hearStorage, loaded, save and saveFailed, with
// `connections`, `asked` and `unsubscribe`.

import type { StorageAdapter } from "../../../../packages/core/src/storage/adapter";
import type { Parsed, RecordUnreadableError, StoredChanges } from "../../../../packages/core/src/storage/records";
import type { Queue } from "../../../../packages/core/src/queue";
import type { ReportProblem } from "../../../../packages/core/src/problems";

export type LinkDeps = Readonly<{
  adapter: StorageAdapter | undefined;
  queue: Queue;
  report: ReportProblem<never>;
  /** The record was given as `initial`, so storage is never asked for it. */
  given: boolean;
  /** Storage has not answered yet, so other tabs are not heard: what they say would land on no record. */
  loading: () => boolean;
  /** The record read, or `failed`. The Run takes it in, with every command held meanwhile, as one change. */
  loaded: (read: Parsed | "failed") => void;
  /** A record saved elsewhere, as storage gave it. */
  heard: (value: unknown) => void;
  /** Storage refused a save because what it holds is a record Waymark cannot read. */
  refused: (error: RecordUnreadableError) => void;
}>;

export type Link = Readonly<{
  /** `run.connect()`. */
  connect: () => () => void;
  /** Only what changed, so a save never writes over what this Run does not know. */
  save: (changes: StoredChanges) => void;
}>;

export function createLink(deps: LinkDeps): Link {
  throw new Error("not implemented");
}
