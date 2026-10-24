import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset URLs: the build works from any sub-path (e.g. GitHub Pages /<repo>/)
  base: './',
  build: {
    target: 'es2022', // top-level await in main.js
    chunkSizeWarningLimit: 1500,
  },
});
