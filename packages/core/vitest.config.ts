import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
          setupFiles: ["./vitest.setup.ts", "./src/test/leaks.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
          setupFiles: ["./src/test/leaks.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium", viewport: { width: 900, height: 600 } }],
            screenshotFailures: false,
          },
        },
      },
      {
        extends: true,
        test: {
          name: "perf",
          include: ["src/**/*.perf.ts"],
          testTimeout: 120_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                args: [
                  "--enable-benchmarking",
                  "--disable-background-timer-throttling",
                  "--disable-renderer-backgrounding",
                ],
              },
            }),
            instances: [{ browser: "chromium", viewport: { width: 900, height: 600 } }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
