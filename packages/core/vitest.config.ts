import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Two projects, one runner:
 *
 *   unit     jsdom, faked clock and rects   src/*.test.ts
 *   browser  real Chromium                  src/*.browser.test.ts
 *   perf     real Chromium, measurements    src/*.perf.ts
 *
 * Browser tests are for what jsdom cannot do: real layout, real scrolling,
 * real pointer coordinates, real time. Behaviour lives in unit tests.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
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
