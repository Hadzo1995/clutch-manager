/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Plugin } from 'vite';

/**
 * Fontsource lists a WOFF fallback after each WOFF2 file. Every browser and WebView the game runs
 * in reads WOFF2, but the single-file build inlined both, so drop the fallbacks (about 0.35 MB).
 */
function woff2Only(): Plugin {
  return {
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '');
    },
  };
}

export default defineConfig({
  plugins: [woff2Only(), react(), viteSingleFile()],
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
