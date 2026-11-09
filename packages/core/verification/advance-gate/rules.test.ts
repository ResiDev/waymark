import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkModel } from "../tla/tlc";

it("holds every rule on every step definition that can be met", async () => {
  const dir = import.meta.dirname;
  const states = await checkModel({
    dir,
    modules: ["AdvanceGate.tla", "MCAdvanceGate.tla"],
    spec: "MCAdvanceGate.tla",
    config: readFileSync(join(dir, "MCAdvanceGate.cfg"), "utf8"),
  });
  expect(states).not.toBe("");
});
