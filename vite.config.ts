import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
// @ts-ignore — plain ESM build script
import { hpAssets } from './scripts/optimize-assets.mjs';

export default defineConfig({
  base: './',
  // production builds: images re-encoded to WebP (≈ −130 MB), unused files pruned — see scripts/optimize-assets.mjs
  plugins: [hpAssets()],
  // agents working in other checkouts can serve the shared asset folder: HP_PUBLIC=/abs/path/public
  publicDir: process.env.HP_PUBLIC || 'public',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
