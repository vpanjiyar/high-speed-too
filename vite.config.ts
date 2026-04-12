import { defineConfig } from 'vite';

export default defineConfig({
  // Increase warning threshold for large static assets
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // PMTiles requires HTTP range-request support, which Vite provides by default.
    // Increase the body limit for serving the large .pmtiles file.
    fs: {
      strict: false,
    },
    proxy: {
      '/api/rtt': {
        target: 'https://api.rtt.io/api/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/rtt/, ''),
        headers: {
          Authorization: `Basic ${process.env.VITE_RTT_AUTH ?? ''}`,
        },
      },
    },
  },
});
