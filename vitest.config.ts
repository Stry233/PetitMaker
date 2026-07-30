import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // `scripts/**` covers the release-tooling tests, which are internal (see
    // docs/internal/deployment/public-repo-manifest.md) — the public snapshot ships no
    // such files, so the pattern simply matches nothing there.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mts'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
