import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

/** Browser tests run with reduced motion; one that checks an animation turns it off for itself. */
const setReducedMotion: BrowserCommand<[reduce: boolean]> = async ({ page }, reduce) => {
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
};

/**
 * This package's own React is 18. The workspace root holds React 19, which no package uses, so its react-dom is
 * linked to its own react; pointed at those folders, each test runs once on each.
 */
const fromRoot = createRequire(new URL('../../package.json', import.meta.url));
const folder = (name: string) => dirname(fromRoot.resolve(`${name}/package.json`));
const react19 = [
  { find: /^react-dom(\/.*)?$/, replacement: `${folder('react-dom')}$1` },
  { find: /^react(\/.*)?$/, replacement: `${folder('react')}$1` },
];

type Test = TestProjectInlineConfiguration['test'];

const unit = (): Test => ({
  environment: 'jsdom',
  include: ['src/**/*.test.{ts,tsx}'],
  exclude: ['src/**/*.browser.test.{ts,tsx}'],
  setupFiles: ['./vitest.setup.ts', './src/test/react-version.ts', './src/test/leaks.ts'],
});

const browser = (): Test => ({
  include: ['src/**/*.browser.test.{ts,tsx}'],
  setupFiles: ['./src/test/react-version.ts', './src/test/leaks.ts'],
  browser: {
    enabled: true,
    headless: true,
    // Reduced motion, so a popover's entrance doesn't scale what a test measures.
    provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
    instances: [{ browser: 'chromium', viewport: { width: 900, height: 600 } }],
    screenshotFailures: false,
    commands: { setReducedMotion },
  },
});

/**
 * One project on this package's React 18, and one named `<name>-react19` on React 19. Each is made afresh, as Vitest
 * writes into a project's browser settings.
 */
const onEachReact = (name: string, test: () => Test): TestProjectInlineConfiguration[] => [
  { extends: true, test: { name, ...test(), provide: { react: '18' } } },
  { extends: true, resolve: { alias: react19 }, test: { name: `${name}-react19`, ...test(), provide: { react: '19' } } },
];

export default defineConfig({
  resolve: {
    alias: {
      'waymark-core': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    restoreMocks: true,
    projects: [...onEachReact('unit', unit), ...onEachReact('browser', browser)],
  },
});
