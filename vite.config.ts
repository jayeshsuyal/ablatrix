import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:4173', changeOrigin: true, configure(proxy) { proxy.on('proxyReq', request => request.setHeader('origin', 'http://127.0.0.1:4173')); } } } }
});
