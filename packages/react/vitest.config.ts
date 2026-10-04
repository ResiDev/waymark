import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'waymark-core': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
