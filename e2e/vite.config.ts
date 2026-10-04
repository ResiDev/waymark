import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const LATENCY = 800;

/**
 * A stand-in server for the React fixture's `?storage=server`: it keeps task
 * statuses in memory at /api/tasks, slowly, so the loading state shows.
 */
function tasksApi(): Plugin {
  let tasks: unknown = null;
  return {
    name: "tasks-api",
    configureServer(server) {
      server.middlewares.use("/api/tasks", (req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          setTimeout(() => {
            if (req.method === "PUT") tasks = JSON.parse(body);
            else if (req.method === "DELETE") tasks = null;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(tasks));
          }, LATENCY);
        });
      });
    },
  };
}

// Serves the fixture pages against the packages' source, so no build step is needed.
export default defineConfig({
  root: "fixtures",
  plugins: [tailwindcss(), tasksApi()],
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
