import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Serves the fixture page against core's source, so no build step is needed.
export default defineConfig({
  root: "fixtures",
  resolve: {
    alias: {
      waymark: fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 4173, strictPort: true },
  logLevel: "warn",
});
