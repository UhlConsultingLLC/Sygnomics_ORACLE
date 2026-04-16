import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    // Run `ANALYZE=1 npm run build` to generate a bundle-size report at
    // frontend/stats.html. Useful for spotting heavy imports (e.g., the
    // full plotly.js build) and deciding what to tree-shake or lazy-load.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'stats.html',
            open: true,
            gzipSize: true,
          }),
        ]
      : []),
  ],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own chunks so the
        // main bundle stays small and Plotly (the largest dep at ~3 MB
        // uncompressed) is cached independently by the browser.
        //
        // Expressed as `codeSplitting.groups` because Vite 8 uses
        // Rolldown as its bundler, and Rolldown dropped the classic
        // Rollup `manualChunks: Record<string, string[]>` object form
        // (it only accepts a function there). `codeSplitting.groups`
        // is the documented Rolldown-native replacement — regex-based
        // filters that express the same intent. (The older
        // `advancedChunks` spelling also works but is deprecated.)
        codeSplitting: {
          groups: [
            { name: 'plotly', test: /[\\/]node_modules[\\/]plotly\.js[\\/]/ },
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](?:react|react-dom|react-router-dom)[\\/]/,
            },
            {
              name: 'tanstack-query',
              test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
            },
          ],
        },
      },
    },
  },
});
