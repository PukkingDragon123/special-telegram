import { defineConfig } from 'vite';
export default defineConfig({
  root: '/home/user/special-telegram',
  base: './',
  publicDir: '/home/user/special-telegram/public',
  server: { port: 5191, strictPort: true, hmr: false, host: '127.0.0.1' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  logLevel: 'warn',
});
