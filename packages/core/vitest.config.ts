import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/v5/**/*.test.{ts,tsx}', 'src/v6/**/*.test.{ts,tsx}', 'src/v7/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
