import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude client tests - they have their own config with jsdom
    exclude: ['client/**', 'node_modules/**'],
  },
});
