import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The library build (tsc) owns dist/; the app bundle goes to dist/app.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/app', emptyOutDir: true },
  server: { proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
});
