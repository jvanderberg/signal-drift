import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// Custom plugin to redirect websocket imports to demo version
function websocketRedirectPlugin(): Plugin {
  const demoWebsocketPath = resolve(__dirname, 'websocket.ts');
  const clientWebsocketPath = resolve(__dirname, '../client/src/websocket');

  return {
    name: 'websocket-redirect',
    enforce: 'pre',
    resolveId(source, importer) {
      // Check if this is an import of the client's websocket module
      if (importer && (source.endsWith('/websocket') || source.endsWith('/websocket.ts'))) {
        // Check if the importer is in the client directory
        if (importer?.includes('/client/src/')) {
          return demoWebsocketPath;
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [websocketRedirectPlugin(), react(), tailwindcss()],
  root: resolve(__dirname),
  base: './', // Relative paths for GitHub Pages
  resolve: {
    alias: {
      // Redirect dependencies to demo's node_modules
      'react': resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'zustand': resolve(__dirname, 'node_modules/zustand'),
      'chart.js': resolve(__dirname, 'node_modules/chart.js'),
      'react-chartjs-2': resolve(__dirname, 'node_modules/react-chartjs-2'),
    },
    // Use demo's node_modules first
    dedupe: ['react', 'react-dom', 'zustand', 'chart.js', 'react-grid-layout', 'react-resizable'],
  },
  build: {
    outDir: resolve(__dirname, 'dist'), // Build output directory
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'chart.js', 'react-chartjs-2', 'react-grid-layout'],
  },
  define: {
    'import.meta.env.DEMO_MODE': JSON.stringify(true),
  },
});
