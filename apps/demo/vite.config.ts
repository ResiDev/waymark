import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Built against the packages' source, like the e2e fixtures, so no package build is needed.
export default defineConfig({
  root: fileURLToPath(new URL("app", import.meta.url)),
  resolve: {
    alias: {
      "waymark-core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "react-waymark": fileURLToPath(new URL("../../packages/react/src/index.ts", import.meta.url)),
    },
    // react-waymark's source resolves React from its own package; both must be one copy.
    dedupe: ["react", "react-dom"],
  },
  server: { port: 4180, strictPort: true },
  preview: { port: 4181, strictPort: true },
  logLevel: "warn",
});
