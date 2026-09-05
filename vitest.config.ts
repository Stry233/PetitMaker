import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // The public snapshot omits release-tooling tests, so this pattern simply matches nothing there.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mts'],
    onConsoleLog(log) {
      // Reduced-motion tests set the preference explicitly; Framer's device advisory is expected.
      if (log.startsWith('You have Reduced Motion enabled on your device.')) return false;
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
