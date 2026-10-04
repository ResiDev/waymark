import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build } from "esbuild";

/**
 * What the packages add to an app's bundle, and how that has changed.
 *
 *   pnpm size        builds the packages, measures, prints, and records
 *
 * Each case bundles the built dist the way an app's bundler would: minified,
 * tree-shaken, with React left to the app. The partial imports double as
 * tree-shaking checks: checklist code leaking into a walkthrough-only import
 * shows as a jump in that row.
 *
 * A run is appended to size-history.jsonl, one JSON object per line, unless
 * nothing differs from the last line. `dirty` means packages/ had uncommitted
 * changes, so the sizes are not those of `commit` alone.
 */

const repo = new URL("../../", import.meta.url);
const packages = fileURLToPath(new URL("packages/", repo));
const historyFile = new URL("size-history.jsonl", repo);
const dist = { waymark: `${packages}core/dist/index.js`, "react-waymark": `${packages}react/dist/index.js` };

/** Keys name the history's columns: add cases freely, but never rename one. */
const cases: Record<string, string> = {
  "react/all": `export * from "react-waymark";`,
  "react/walkthrough": `export { defineWalkthrough, Walkthrough } from "react-waymark";`,
  "react/headless": `export { createChecklists, localStorageAdapter, useChecklist } from "react-waymark";`,
  "core/all": `export * from "waymark";`,
  "core/run": `export { createRun, defineWalkthrough } from "waymark";`,
  "core/checklists": `export { createChecklists } from "waymark";`,
};

/** Bytes. */
type Size = Readonly<{ min: number; gzip: number; brotli: number }>;

type Entry = Readonly<{
  date: string;
  commit: string;
  dirty: boolean;
  sizes: Readonly<Record<string, Size>>;
}>;

const measure = async (contents: string): Promise<Size> => {
  const result = await build({
    stdin: { contents, resolveDir: packages, loader: "js" },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "silent",
    alias: dist,
    external: ["react", "react-dom", "react/jsx-runtime"],
  });
  const code = result.outputFiles[0]!.contents;
  return {
    min: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
};

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

const lastEntry = (): Entry | undefined => {
  if (!existsSync(historyFile)) return undefined;
  const line = readFileSync(historyFile, "utf8").trim().split("\n").at(-1);
  return line ? (JSON.parse(line) as Entry) : undefined;
};

const kB = (bytes: number) => `${(bytes / 1024).toFixed(2)} kB`;
const delta = (now: number, before: number | undefined) => {
  if (before === undefined) return "new";
  const change = now - before;
  return change === 0 ? "=" : `${change > 0 ? "+" : ""}${change} B`;
};

for (const [name, file] of Object.entries(dist)) {
  if (!existsSync(file)) throw new Error(`No build of ${name} at ${file}. Run pnpm size from the repo root, which builds first.`);
}

const sizes: Record<string, Size> = Object.fromEntries(
  await Promise.all(Object.entries(cases).map(async ([name, contents]) => [name, await measure(contents)] as const)),
);

const entry: Entry = {
  date: new Date().toISOString(),
  commit: git("rev-parse", "--short", "HEAD"),
  dirty: git("status", "--porcelain", "--", "packages").length > 0,
  sizes,
};
const previous = lastEntry();

console.table(
  Object.fromEntries(
    Object.entries(sizes).map(([name, size]) => [
      name,
      {
        min: kB(size.min),
        gzip: kB(size.gzip),
        brotli: kB(size.brotli),
        "gzip vs last": delta(size.gzip, previous?.sizes[name]?.gzip),
      },
    ]),
  ),
);

const unchanged =
  previous !== undefined &&
  previous.commit === entry.commit &&
  previous.dirty === entry.dirty &&
  JSON.stringify(previous.sizes) === JSON.stringify(entry.sizes);

if (unchanged) {
  console.log(`Same as the last entry (${previous.commit}); not recorded.`);
} else {
  appendFileSync(historyFile, `${JSON.stringify(entry)}\n`);
  console.log(`Recorded in size-history.jsonl as ${entry.commit}${entry.dirty ? " (with uncommitted changes)" : ""}.`);
}
