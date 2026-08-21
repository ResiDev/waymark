import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Behaviour lives in `waymark`; this package's tests arrive with the playground.
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
