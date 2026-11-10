import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkModel } from "../tla/tlc";

const dir = import.meta.dirname;
const model = (cfg: string) => ({
  dir,
  modules: ["Lifecycle.tla", "MCLifecycle.tla"],
  spec: "MCLifecycle.tla",
  config: readFileSync(join(dir, cfg), "utf8"),
});

it("holds every rule that the code keeps, for two tours and a hint", async () => {
  expect(await checkModel(model("MCLifecycle.cfg"))).not.toBe("");
});

// Each rule the code breaks, in a config of its own. findings.test.ts
// reproduces each on the real Run. Once the code is fixed and the model copies
// the fix, the rule moves into MCLifecycle.cfg and its line here goes.
it.concurrent.for([
  ["StepInRange", "a heard step this release's tour does not have", "Invariant"],
  ["ChangesNeverThrow", "the same, as a RangeError inside the change", "Invariant"],
  ["StartAlwaysShows", "the same, as a click on the tour's button that shows nothing", "Action property"],
  ["HintNeverPartWay", "a hint heard open in another tab waits collapsed here, behind a beacon", "Invariant"],
  ["RestoredReopens", "a heard echo collapses a walkthrough restored open before its page mounts", "Invariant"],
] as const)("finds %s broken: %s", async ([rule, , kind]) => {
  await expect(checkModel(model(`Broken${rule}.cfg`))).rejects.toThrow(`${kind} ${rule} is violated`);
});
