import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Must match the host's MYTHIC_PORT (default 8787); the e2e harness and dev:table set it.
const hostPort = process.env['MYTHIC_PORT'] ?? '8787';

// The library build (tsc) owns dist/; the app bundle goes to dist/app.
export default defineConfig({
  plugins: [react()],
  // assetsDir is not "assets": the host owns /assets/* for uploaded images (M1-10).
  build: { outDir: 'dist/app', assetsDir: 'static', emptyOutDir: true },
  server: {
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${hostPort}`, ws: true },
      // Most specific first: the routes that check the caller's origin keep the browser's Host, the
      // rest of /api (history) is plain.
      '/api/spectator-link': { target: `http://127.0.0.1:${hostPort}`, changeOrigin: false },
      '/api/seat-invites': { target: `http://127.0.0.1:${hostPort}`, changeOrigin: false },
      '/api': `http://127.0.0.1:${hostPort}`,
      '/assets': `http://127.0.0.1:${hostPort}`,
    },
  },
});
