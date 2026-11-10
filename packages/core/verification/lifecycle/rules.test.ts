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

// A rule the code breaks gets a Broken<Rule>.cfg of its own and an `it` here
// that expects TLC to find it violated, with a repro in findings.test.ts. Once
// the code is fixed and the model copies the fix, it moves into MCLifecycle.cfg.
