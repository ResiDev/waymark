import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkModel, type Model } from "../tla/tlc";

const dir = import.meta.dirname;
const model = (config: string): Model => ({ dir, modules: ["Shell.tla"], spec: "Shell.tla", config: readFileSync(join(dir, config), "utf8") });

it.concurrent("holds every rule the shell keeps, for every script of two listeners and onEvent", async () => {
  expect(await checkModel(model("MCShell.cfg"))).not.toBe("");
});

// Each of these is a bug in the code, reproduced in bugs.test.ts. Once one is fixed, its
// part of Shell.tla changes with the code, and its rule moves to MCShell.cfg.
const broken = [
  ["MCConnectionsHeld.cfg", "a connect that throws stays connected with no disconnect", /Invariant ConnectionsHeld is violated/],
] as const;

it.concurrent.for(broken)("TLC finds the bug: %s, %s", async ([config, , violation]) => {
  await expect(checkModel(model(config))).rejects.toThrow(violation);
});
