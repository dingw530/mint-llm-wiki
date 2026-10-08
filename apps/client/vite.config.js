import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isElectronBuild = process.env.ELECTRON === 'true';
const devPort = Number(process.env.VITE_DEV_PORT || 5800);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  base: isElectronBuild ? './' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: devPort,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'markdown-vendor': [
            'react-markdown',
            'remark-gfm',
            'rehype-highlight',
            'rehype-sanitize',
            'hast-util-sanitize',
          ],
          'graph-vendor': ['@visactor/vgraph'],
        },
      },
    },
  },
});
