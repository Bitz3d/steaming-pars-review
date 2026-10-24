import { defineConfig } from 'vite';

// Relative URLs support the GitHub Pages repository subpath and local previews.
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'docs' },
});
