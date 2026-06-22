import { defineConfig } from 'vite';
import path from 'path';

// Portable build: relative base so the game runs under any deploy sub-path.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // three's importmap addons path → the npm package's bundled examples.
      'three/addons/': path.resolve(__dirname, 'node_modules/three/examples/jsm/'),
    },
  },
  preview: { host: '0.0.0.0', allowedHosts: true },
  server: { host: '0.0.0.0', allowedHosts: true },
});
