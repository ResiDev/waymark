import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkModel } from "../tla/tlc";

const dir = import.meta.dirname;
const model = (file: string) => ({
  dir,
  modules: ["Storage.tla", "MCStorage.tla"],
  spec: "MCStorage.tla",
  config: readFileSync(join(dir, file), "utf8"),
});

it.each([
  ["localStorage", "MCLocal.cfg"],
  ["a server that pushes every write", "MCRemote.cfg"],
  ["a server that pushes every write, to tabs that disconnect", "MCRemoteUnmounts.cfg"],
  ["a server that pushes every write and never fails", "MCRemoteReliable.cfg"],
  ["a save adapter that answers later", "MCSaveAsync.cfg"],
])("holds every rule its config lists on %s", async (_, file) => {
  expect(await checkModel(model(file))).not.toBe("");
});

// Each a bug: bugs.test.ts reproduces it on the real code. Flip one to the list above once it is fixed.
it.each([
  ["SaveKeepsOthersEntries", "BrokenSaveKeepsOthersEntries.cfg"],
  ["NeverOverwriteUnreadable", "BrokenNeverOverwriteUnreadable.cfg"],
])("breaks %s in %s", async (rule, file) => {
  await expect(checkModel(model(file))).rejects.toThrow(`Invariant ${rule} is violated`);
});
