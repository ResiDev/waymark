// One stored record that several Runs share, through adapters whose answers the test gives, one at a time, in any order.
// Answers are thenables the test settles synchronously, so a whole walk runs without awaiting.
import type { SaveAdapter, SavePartialAdapter, StorageAdapter } from "../../src/storage/adapter";
import { applyChanges } from "../../src/storage/records";
import type { RecordChanges, StoredRecord } from "../../src/storage/records";

type Settle = Readonly<{ ok: (value: unknown) => void; fail: (error: unknown) => void }>;

/** A promise-like the link accepts, settled when the test says so, synchronously. */
function deferred<T>() {
  let settle: Settle | undefined;
  const thenable = {
    // oxlint-disable-next-line unicorn/no-thenable -- standing in for an adapter's promise, settled by the test.
    then(ok: (value: T) => void, fail: (error: unknown) => void) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolved only with a T below.
      settle = { ok: ok as (value: unknown) => void, fail };
    },
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the link only calls then, as on a promise.
    thenable: thenable as unknown as Promise<T>,
    resolve: (value: T) => settle?.ok(value),
    reject: (error: unknown) => settle?.fail(error),
  };
}

export type Options = Readonly<{
  kind: "partial" | "whole";
  /** Loads and saves wait for the test; otherwise each answers at once, as localStorage does. */
  async: boolean;
  /** A tab hears its own writes too, as a server's push to every tab would. localStorage does not. */
  tellsOwnWrites: boolean;
  /** A tab told of a write reads what is stored when it hears, as localStorageAdapter does; otherwise it hears the record as written, in order. */
  hearCurrent: boolean;
}>;

type Side = {
  loads: ReturnType<typeof deferred<StoredRecord | null>>[];
  /** A connect load's answer, read from the store and not yet delivered. */
  read: Readonly<{ value: unknown; failed: boolean }> | undefined;
  saves: { body: RecordChanges | StoredRecord | null; answer: ReturnType<typeof deferred<void>> }[];
  listener: ((record: StoredRecord | null) => void) | undefined;
  toHear: unknown[];
  notified: boolean;
  /** For a synchronous adapter: whether its next load or save throws. */
  failNext: boolean;
};

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Keys sorted, and an empty record as null, so two records that hold the same compare equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  // oxlint-disable-next-line unicorn/no-array-sort -- the lib in tsconfig has no toSorted; Object.entries gives a fresh array.
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const record = Object.fromEntries(entries.map(([key, inner]) => [key, canonical(inner)]));
  if ("walkthroughs" in record && "tasks" in record && Object.keys(record["walkthroughs"] ?? {}).length === 0 && Object.keys(record["tasks"] ?? {}).length === 0) {
    return null;
  }
  return record;
}

export function backend(initial: unknown, options: Options) {
  let stored = initial;
  const sides: Side[] = [];

  const write = (by: Side | undefined, value: unknown) => {
    const changed = !same(value, stored);
    stored = value;
    if (!changed) return;
    for (const side of sides) {
      if (side.listener === undefined || (side === by && !options.tellsOwnWrites)) continue;
      if (options.hearCurrent) side.notified = true;
      else side.toHear.push(value);
    }
  };

  const sideOf = (index: number): Side => {
    const side = sides[index];
    if (side === undefined) throw new Error(`No tab ${index}`);
    return side;
  };

  /** A synchronous adapter's next call fails when the test said so. */
  const failing = (side: Side, what: string) => {
    if (!side.failNext) return;
    side.failNext = false;
    throw new Error(`${what} failed`);
  };

  /** The adapter for one more tab. */
  const tab = (): StorageAdapter => {
    const side: Side = { loads: [], read: undefined, saves: [], listener: undefined, toHear: [], notified: false, failNext: false };
    sides.push(side);
    const load = () => {
      if (!options.async) {
        failing(side, "load");
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it loads.
        return stored as StoredRecord | null;
      }
      const answer = deferred<StoredRecord | null>();
      side.loads.push(answer);
      return answer.thenable;
    };
    const subscribe = (listener: (record: StoredRecord | null) => void) => {
      side.listener = listener;
      return () => {
        side.listener = undefined;
        side.toHear = [];
        side.notified = false;
      };
    };
    if (options.kind === "whole") {
      const adapter: SaveAdapter = {
        load,
        save: (record) => {
          if (!options.async) {
            failing(side, "save");
            write(side, record);
            return;
          }
          const answer = deferred<void>();
          side.saves.push({ body: record, answer });
          return answer.thenable;
        },
        subscribe,
      };
      return adapter;
    }
    const adapter: SavePartialAdapter = {
      load,
      savePartial: (changes) => {
        if (!options.async) {
          failing(side, "save");
          write(side, applyChanges(stored, changes));
          return;
        }
        const answer = deferred<void>();
        side.saves.push({ body: changes, answer });
        return answer.thenable;
      },
      subscribe,
    };
    return adapter;
  };

  return {
    tab,
    stored: () => stored,
    /** Another device writes. */
    put: (value: unknown) => write(undefined, value),
    /** The server reads the record for a tab's load, or fails it, without the tab having it yet. */
    readLoad: (index: number, failed = false) => {
      sideOf(index).read = { value: stored, failed };
    },
    /** The tab gets the answer read for its load. */
    deliverLoad: (index: number) => {
      const side = sideOf(index);
      const answer = side.loads.shift();
      const read = side.read;
      if (answer === undefined || read === undefined) throw new Error(`Tab ${index} has no load answered`);
      side.read = undefined;
      if (read.failed) answer.reject(new Error("load failed"));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it loads.
      else answer.resolve(read.value as StoredRecord | null);
    },
    /** Reads and delivers a load in one go, as a save adapter's load before a save. */
    answerLoad: (index: number, failed = false) => {
      const side = sideOf(index);
      side.read = { value: stored, failed };
      const answer = side.loads.shift();
      const read = side.read;
      side.read = undefined;
      if (answer === undefined) throw new Error(`Tab ${index} has no load waiting`);
      if (read.failed) answer.reject(new Error("load failed"));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it loads.
      else answer.resolve(read.value as StoredRecord | null);
    },
    /** The tab's save at `at` reaches storage: a whole record is stored, changes are applied to what is stored. */
    land: (index: number, at = 0) => {
      const side = sideOf(index);
      const [save] = side.saves.splice(at, 1);
      if (save === undefined) throw new Error(`Tab ${index} has no save ${at}`);
      if (options.kind === "whole") {
        write(side, save.body);
        save.answer.resolve();
        return;
      }
      let next: unknown;
      try {
        next = applyChanges(stored, save.body);
      } catch (error) {
        save.answer.reject(error);
        return;
      }
      write(side, next);
      save.answer.resolve();
    },
    /** The tab's save at `at` fails before it reaches storage. */
    failSave: (index: number, at = 0) => {
      const [save] = sideOf(index).saves.splice(at, 1);
      if (save === undefined) throw new Error(`Tab ${index} has no save ${at}`);
      save.answer.reject(new Error("save failed"));
    },
    /** For a synchronous adapter: the tab's next load or save throws. */
    failNext: (index: number) => {
      sideOf(index).failNext = true;
    },
    /** The tab hears the next record it was told of. */
    hear: (index: number) => {
      const side = sideOf(index);
      const listener = side.listener;
      if (listener === undefined) throw new Error(`Tab ${index} is not listening`);
      let value: unknown;
      if (options.hearCurrent) {
        if (!side.notified) throw new Error(`Tab ${index} was told of nothing`);
        side.notified = false;
        value = stored;
      } else {
        if (side.toHear.length === 0) throw new Error(`Tab ${index} was told of nothing`);
        value = side.toHear.shift();
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- core checks every value it hears.
      listener(value as StoredRecord | null);
    },
    /** What a tab has outstanding, for the conformance walk. */
    side: (index: number) => {
      const side = sideOf(index);
      return {
        loads: side.loads.length,
        read: side.read,
        saves: side.saves.map((save) => save.body),
        listening: side.listener !== undefined,
        toHear: [...side.toHear],
        notified: side.notified,
      };
    },
  };
}

export type Backend = ReturnType<typeof backend>;
