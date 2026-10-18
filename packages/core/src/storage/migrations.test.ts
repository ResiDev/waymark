import { describe, expect, it } from "vitest";
import { migrate } from "./migrations";
import type { Migrations } from "./migrations";

const steps: Migrations = {
  1: (record) => ({ version: 2, tasks: record["statuses"] }),
  2: (record) => ({ version: 3, walkthroughs: {}, tasks: record["tasks"] }),
};

describe("migrate", () => {
  it("brings a record up one version at a time", () => {
    expect(migrate({ version: 1, statuses: { a: "done" } }, steps, 3)).toEqual({ version: 3, walkthroughs: {}, tasks: { a: "done" } });
  });

  it("leaves a record of the version asked for as it is", () => {
    const current = { version: 3, walkthroughs: {}, tasks: {} };
    expect(migrate(current, steps, 3)).toBe(current);
  });

  it("throws where a step is missing, or does not give the next version", () => {
    expect(() => migrate({ version: 1 }, { 2: steps[2]! }, 3)).toThrow(/no way up from version 1/);
    expect(() => migrate({ version: 1 }, { 1: () => ({ version: 3 }) }, 3)).toThrow(/did not give version 2/);
  });
});
