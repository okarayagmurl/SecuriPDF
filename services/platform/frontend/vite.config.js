import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/main.jsx'),
      name: 'SecuriPDFRedaction',
      formats: ['iife'],
      fileName: () => 'redaction-ui.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'redaction-ui.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
