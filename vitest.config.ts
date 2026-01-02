import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude client tests (they have their own config), node_modules, and compiled output
    exclude: ['client/**', 'node_modules/**', 'dist/**', '.worktrees/**'],
  },
});
