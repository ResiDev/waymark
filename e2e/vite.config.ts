import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const LATENCY = 800;

/**
 * A stand-in server for the React fixture's `?storage=server`: it keeps the
 * Run's record, every walkthrough's progress and every task's status, in
 * memory at /api/record, slowly, so the loading state shows.
 */
function recordApi(): Plugin {
  let record: unknown = null;
  return {
    name: "record-api",
    configureServer(server) {
      server.middlewares.use("/api/record", (req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          setTimeout(() => {
            if (req.method === "PUT") record = JSON.parse(body);
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
