import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { compression } from 'vite-plugin-compression2';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    preact(),
    viteSingleFile(),
    // Compress everything down to the last byte to measure against the 14KB rule
    compression({ algorithms: ['brotliCompress', 'gzip'], threshold: 0 }),
    // Generate the stats.html file on build to prove we beat the constraint
    visualizer({
      filename: 'stats.html',
      template: 'treemap',
      brotliSize: true,
      gzipSize: true
    })
  ],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    chunkSizeWarningLimit: 40,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

});
