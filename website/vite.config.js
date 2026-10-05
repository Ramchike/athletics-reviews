import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()], base: '/athletics-reviews/',
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { output: { manualChunks(id) {
    if (id.includes('node_modules')) return id.includes('react-dom') || /node_modules\/react\//.test(id) || id.includes('scheduler') ? 'react-runtime' : 'markdown-runtime';
    if (id.endsWith('project-data.json')) return 'training-records';
  } } } },
});
