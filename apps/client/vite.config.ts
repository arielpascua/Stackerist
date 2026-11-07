import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/** Dev-only: where `pnpm dev` runs the Fastify server (proxied for /ws and /healthz). */
const serverOrigin = process.env.STACKERIST_SERVER_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Workspace packages resolve to their TypeScript sources (no prebuild, live reload).
    conditions: ['@stackerist/source', ...defaultClientConditions],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: serverOrigin, ws: true },
      '/healthz': { target: serverOrigin },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
