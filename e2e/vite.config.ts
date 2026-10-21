import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const LATENCY = 800;

type Entries = Record<string, unknown>;
type Kinds<T> = Readonly<{ walkthroughs: T; tasks: T }>;
type Stored = Readonly<{ version: number } & Kinds<Entries>>;
type Changes = Readonly<{ version: number; set: Kinds<Entries>; remove: Kinds<readonly string[]>; replace?: true }>;

/** As Waymark's `applyChanges` does, without loading its source into the config. */
const applyChanges = (record: Stored | null, changes: Changes): Stored | null => {
  const base = changes.replace === true ? null : record;
  const merge = (kind: keyof Kinds<unknown>) => {
    const entries = { ...base?.[kind], ...changes.set[kind] };
    for (const id of changes.remove[kind]) delete entries[id];
    return entries;
  };
  const walkthroughs = merge("walkthroughs");
  const tasks = merge("tasks");
  if (Object.keys(walkthroughs).length === 0 && Object.keys(tasks).length === 0) return null;
  return { version: changes.version, walkthroughs, tasks };
};

/**
 * A stand-in server for the React fixture's `?storage=server`: it keeps the
 * Run's record, every walkthrough's progress and every task's status, in
 * memory at /api/record, slowly, so the loading state shows. A PATCH makes
 * a save's changes to it, as an app's server would.
 */
function recordApi(): Plugin {
  let record: Stored | null = null;
  return {
    name: "record-api",
    configureServer(server) {
      server.middlewares.use("/api/record", (req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          setTimeout(() => {
            if (req.method === "PATCH") record = applyChanges(record, JSON.parse(body) as Changes);
            else if (req.method === "DELETE") record = null;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(record));
          }, LATENCY);
        });
      });
    },
  };
}

// Serves the fixture pages against the packages' source, so no build step is needed.
export default defineConfig({
  root: "fixtures",
  plugins: [tailwindcss(), recordApi()],
  resolve: {
    alias: {
      "waymark-core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "react-waymark": fileURLToPath(new URL("../packages/react/src/index.ts", import.meta.url)),
    },
    // react-waymark's source resolves React from its own package; both must be one copy.
    dedupe: ["react", "react-dom"],
  },
  server: { port: 4173, strictPort: true },
  logLevel: "warn",
});
