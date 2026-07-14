import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './', // Relative paths for Electron production
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.SIGNAL_DRIFT_DRIVER_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.SIGNAL_DRIFT_DRIVER_URL ?? 'http://localhost:3001',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', '../.worktrees/**'],
  },
});
