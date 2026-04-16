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
});
