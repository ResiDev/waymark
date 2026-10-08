import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

/** Browser tests run with reduced motion; one that checks an animation turns it off for itself. */
const setReducedMotion: BrowserCommand<[reduce: boolean]> = async ({ page }, reduce) => {
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
};

export default defineConfig({
  resolve: {
    alias: {
      'waymark-core': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts', './src/test/leaks.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['./src/test/leaks.ts'],
          browser: {
            enabled: true,
            headless: true,
            // Reduced motion, so a popover's entrance doesn't scale what a test measures.
            provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
            instances: [{ browser: 'chromium', viewport: { width: 900, height: 600 } }],
            screenshotFailures: false,
            commands: { setReducedMotion },
          },
        },
      },
    ],
  },
});
