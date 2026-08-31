import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      waymark: new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/v5/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
