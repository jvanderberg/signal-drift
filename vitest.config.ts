import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude client tests (they have their own config), e2e tests (Playwright), node_modules (any depth), and compiled output
    exclude: ['client/**', 'e2e/**', '**/node_modules/**', 'dist/**', '.worktrees/**'],
  },
});
