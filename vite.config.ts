import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { injectLoadCacheBust } from './src/shared/loadCacheBust.ts';

function loadCacheBustPlugin(): Plugin {
  return {
    name: 'load-cache-bust',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return injectLoadCacheBust(html);
      },
    },
  };
}

export default defineConfig({
  plugins: [loadCacheBustPlugin()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  },
  server: {
    port: 5173,
    host: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  },
  preview: {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  },
});
