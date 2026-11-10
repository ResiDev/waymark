import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkModel } from "../tla/tlc";

const dir = import.meta.dirname;
const check = (config: string) =>
  checkModel({ dir, modules: ["Tasks.tla", "MCTasks.tla"], spec: "MCTasks.tla", config: readFileSync(join(dir, config), "utf8") });

it.concurrent.for(["MCTasks.cfg", "MCTasksShared.cfg"])("holds every rule in %s", async (config) => {
  expect(await check(config)).not.toBe("");
});
