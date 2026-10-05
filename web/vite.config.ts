import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { compression } from 'vite-plugin-compression2';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  const isCachedComparisonBuild = mode === 'cached';

  return {
    plugins: [
      preact(),
      // The default production build remains the one-file experiment.
      // The cached comparison build leaves Vite's hashed JS and CSS external.
      ...(!isCachedComparisonBuild ? [viteSingleFile()] : []),
      // Compress everything down to the last byte to measure against the 14KB rule
      compression({ algorithms: ['brotliCompress', 'gzip'], threshold: 0 }),
      // Keep each build audit separate so the comparison is inspectable.
      visualizer({
        filename: isCachedComparisonBuild ? 'stats-cached.html' : 'stats.html',
        template: 'treemap',
        brotliSize: true,
        gzipSize: true
      })
    ],
    build: {
      outDir: isCachedComparisonBuild ? 'dist-cached' : 'dist',
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: false,
          drop_debugger: false
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
  };
});
