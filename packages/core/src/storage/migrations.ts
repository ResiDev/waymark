/**
 * The version of the record Waymark writes. A change to the record's shape
 * raises it, with a step from the version before into `MIGRATIONS`.
 */
export const VERSION = 1;

type Unread = Readonly<Record<string, unknown>>;

/**
 * Each takes a record of its version, by number, to the next version. Each
 * old shape is written out in its step, not taken from today's types, so a
 * later change to the record cannot change what an old step does.
 */
export type Migrations = Readonly<Record<number, (record: Unread) => Unread>>;

/** None yet: version 1 is the first. */
const MIGRATIONS: Migrations = {};

/**
 * Brings an older record up to `to`, one version at a time. Throws when a
 * step is missing or does not give the next version, so the record is
 * reported as unreadable rather than read wrong.
 */
export function migrate(record: Unread, steps: Migrations = MIGRATIONS, to: number = VERSION): Unread {
  let current = record;
  while (typeof current["version"] === "number" && current["version"] < to) {
    const from = current["version"];
    const step = steps[from];
    if (step === undefined) throw new Error(`Waymark has no way up from version ${from}.`);
    current = step(current);
    if (current["version"] !== from + 1) throw new Error(`The step up from version ${from} did not give version ${from + 1}.`);
  }
  return current;
}
