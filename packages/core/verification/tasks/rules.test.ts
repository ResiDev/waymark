import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkModel } from "../tla/tlc";

const dir = import.meta.dirname;
const check = (config: string) =>
  checkModel({ dir, modules: ["Tasks.tla", "MCTasks.tla"], spec: "MCTasks.tla", config: readFileSync(join(dir, config), "utf8") });

it.concurrent.for(["MCTasks.cfg", "MCTasksShared.cfg", "MountTicksFinishedDone.cfg"])("holds every rule in %s", async (config) => {
  expect(await check(config)).not.toBe("");
});

// Each breaks today, because the code does. Rerun its .cfg with TLC to read the trace;
// bugs.test.ts reproduces each on the real Run. When the code is fixed, fix the model
// to match (conformance.test.ts says where), and move the rule into MCTasks.cfg.
it.concurrent.for([
  ["DoneOnFinish.cfg", "Invariant DoneOnFinish is violated"],
  ["ConditionTicks.cfg", "Invariant ConditionTicks is violated"],
  ["SkippedBecomesDone.cfg", "Invariant SkippedBecomesDone is violated"],
  // Not the code: a fix for thread 7 that ticks a task the user unticked.
  ["MountTicksFinished.cfg", "Action property TodoLeavesOnlyByCause is violated"],
] as const)("breaks as %s says", async ([config, broken]) => {
  await expect(check(config)).rejects.toThrow(broken);
});
