// Runs TLC on a model: either to check its rules, or to dump its state graph for a conformance walk.
import { spawn } from "node:child_process";
import { copyFileSync, createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { inject } from "vitest";
import { variables, type Value } from "./values";

export type Model = Readonly<{
  /** The folder that holds the model's modules. */
  dir: string;
  /** Every .tla module the spec needs, by file name. */
  modules: readonly string[];
  /** The module TLC checks, such as MCAdvanceGate.tla. */
  spec: string;
  /** The text of TLC's .cfg file. */
  config: string;
}>;

/** The states TLC reached, the initial ones, and the moves between them by action name. */
export type Graph<S> = Readonly<{
  states: ReadonlyMap<string, S>;
  initial: readonly string[];
  moves: ReadonlyMap<string, readonly (readonly [to: string, action: string])[]>;
}>;

/** Checks the config's invariants and properties on every reachable state. Resolves with TLC's count of distinct states. */
export async function checkModel(model: Model): Promise<string> {
  const output = await inTempDir(model, (dir) => tlc(model, dir, ["-workers", "auto"]));
  if (!output.includes("Model checking completed. No error has been found.")) throw new Error(`A rule breaks:\n${output}`);
  return /[\d,]+ distinct states found/.exec(output)?.[0] ?? "";
}

/** Has TLC dump every state and move, and reads each state with toState. */
export async function dumpGraph<S>(model: Model, toState: (get: (name: string) => Value) => S): Promise<Graph<S>> {
  return inTempDir(model, async (dir) => {
    const dot = join(dir, "graph.dot");
    await tlc(model, dir, ["-workers", "1", "-dump", "dot,actionlabels", dot]);
    return readGraph(dot, toState);
  });
}

// Each run gets its own directory, with its own copy of the modules and its own Java temp directory:
// TLC runs side by side fail to parse at times when they share one.
async function inTempDir<T>(model: Model, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "tlc-"));
  try {
    for (const module of model.modules) copyFileSync(join(model.dir, module), join(dir, module));
    writeFileSync(join(dir, "model.cfg"), model.config);
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tlc(model: Model, dir: string, extra: readonly string[]): Promise<string> {
  const { jar, java } = inject("tla");
  const args = ["-XX:+UseParallelGC", `-Djava.io.tmpdir=${dir}`, "-cp", jar, "tlc2.TLC", "-deadlock", "-metadir", join(dir, "meta")];
  args.push(...extra, "-config", "model.cfg", model.spec);
  return new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`TLC failed (${code}):\n${output}`))));
  });
}

const unescape = (text: string) => text.replaceAll(/\\(.)/g, (_, char: string) => (char === "n" ? "\n" : char));

async function readGraph<S>(path: string, toState: (get: (name: string) => Value) => S): Promise<Graph<S>> {
  const states = new Map<string, S>();
  const initial: string[] = [];
  const moves = new Map<string, (readonly [string, string])[]>();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const move = /^(-?\d+) -> (-?\d+) \[label="(\w+)"/.exec(line);
    if (move?.[1] !== undefined && move[2] !== undefined && move[3] !== undefined) {
      const out = moves.get(move[1]) ?? [];
      out.push([move[2], move[3]]);
      moves.set(move[1], out);
      continue;
    }
    const node = /^(-?\d+) \[label="(.*)"(,style = filled)?\];?$/.exec(line);
    if (node?.[1] !== undefined && node[2] !== undefined && !states.has(node[1])) {
      states.set(node[1], toState(variables(unescape(node[2]))));
      if (node[3] !== undefined) initial.push(node[1]);
    }
  }
  return { states, initial, moves };
}
