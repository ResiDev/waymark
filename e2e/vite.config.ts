import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Serves the fixture pages against the packages' source, so no build step is needed.
export default defineConfig({
  root: "fixtures",
  plugins: [tailwindcss()],
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
