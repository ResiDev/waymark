// Vitest's global setup for the verification project: finds Java and fetches TLC once, before any test runs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

const VERSION = "1.7.4";
const SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const URL = `https://github.com/tlaplus/tlaplus/releases/download/v${VERSION}/tla2tools.jar`;

declare module "vitest" {
  export interface ProvidedContext {
    tla: Readonly<{ jar: string; java: string }>;
  }
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export default async function setup(project: TestProject) {
  const java = process.env["JAVA"] ?? "java";
  if (spawnSync(java, ["-version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("The verification tests need Java 11 or later on PATH, or JAVA set to it.");
  }
  const cache = join(import.meta.dirname, "../../node_modules/.cache/tla");
  const jar = join(cache, `tla2tools-${VERSION}.jar`);
  if (!existsSync(jar) || sha256(readFileSync(jar)) !== SHA256) {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`Could not fetch tla2tools.jar ${VERSION}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== SHA256) throw new Error(`tla2tools.jar ${VERSION} does not match its checksum.`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(`${jar}.part`, bytes);
    renameSync(`${jar}.part`, jar);
  }
  project.provide("tla", { jar, java });
}
