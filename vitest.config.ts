import { globSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Browser journeys and timing benches each run as their own project, outside `npm run test:run`.
const E2E = ['**/*.e2e.*'];
const PERF = ['src/__tests__/perf/**/*.perf.test.ts'];
// The public snapshot omits release-tooling tests, so the script patterns simply match nothing there.
const UNIT = ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mts', 'scripts/**/*.test.ts', 'scripts/**/*.test.tsx'];
const UNIT_EXCLUDE = [...configDefaults.exclude, ...E2E, ...PERF];

/**
 * Test folders whose files may share one module graph per worker. Editing tools, the editor layer, the
 * view input layer and the UI keep interaction state in modules (an open curve session, a running
 * macro, a hover target), so their tests stay isolated.
 */
export const SHARED_FOLDERS = [
  'src/__tests__/', 'src/__tests__/agent/**/', 'src/__tests__/assets/**/', 'src/__tests__/view/',
  'src/__tests__/view/map2d/**/', 'src/__tests__/view/map3d/**/', 'src/__tests__/view/shared/**/',
  'src/__tests__/config/**/', 'src/__tests__/core/**/', 'src/__tests__/pipelines/**/', 'src/__tests__/i18n/**/', 'src/__tests__/io/**/', 'src/__tests__/platform/**/',
  'src/__tests__/legal/**/', 'src/__tests__/repo/**/', 'src/__tests__/scripts/**/', 'src/__tests__/rules/**/', 'src/__tests__/state/**/',
  'src/__tests__/tools/generation/**/', 'src/__tests__/tools/placement/**/', 'scripts/**/',
];

/**
 * What makes a file in those folders still need a fresh module graph: a DOM environment, module
 * mocks, fake clocks, runner config changes (the long suites that raise their timeout), stubbed
 * globals, the editor store, test hooks (`__name(`) that reset module state, or installing a
 * process-wide implementation (`installX(`).
 */
export const NEEDS_ISOLATION =
  /@vitest-environment jsdom|vi\.(mock|doMock|hoisted|importActual|importMock|useFakeTimers|setSystemTime|stubGlobal|stubEnv|resetModules|setConfig)\b|globalThis\.\w+\s*=|Object\.defineProperty\(globalThis|state\/store['"]|useEditorStore|\b__[a-zA-Z]\w*\(|\binstall[A-Z]\w*\(/;

const ROOT = import.meta.dirname;

/** Unit test files that share one module graph per worker; every other unit file runs isolated. */
export const SHARED_UNIT_FILES = globSync(SHARED_FOLDERS.map((dir) => `${dir}*.test.{ts,tsx,mts}`), { cwd: ROOT })
  .map((p) => p.split('\\').join('/'))
  .filter((p) => !/\.e2e\./.test(p) && !NEEDS_ISOLATION.test(readFileSync(join(ROOT, p), 'utf8')))
  .sort();

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // A worker peaks near 0.8 GB, so twelve keep a full run near 10 GB; on a shared machine more
    // workers add contention faster than throughput.
    maxWorkers: Math.min(12, Math.max(1, availableParallelism() - 1)),
    // Files that need a DOM open with a `// @vitest-environment jsdom` docblock; jsdom setup costs
    // most of a small file's run time, so it is not the default.
    environment: 'node',
    setupFiles: ['./src/__tests__/_support/setup.ts'],
    // Transformed modules persist under node_modules/.vitest-cache, keyed by content, so a rerun skips the transform.
    fsModuleCache: true,
    onConsoleLog(log) {
      // Reduced-motion tests set the preference explicitly; Framer's device advisory is expected.
      if (log.startsWith('You have Reduced Motion enabled on your device.')) return false;
    },
    projects: [
      // `npm run test:run` runs both unit projects; together they hold every unit file exactly once.
      { extends: true, test: { name: 'unit-isolated', include: UNIT, exclude: [...UNIT_EXCLUDE, ...SHARED_UNIT_FILES] } },
      // Modules load once per worker instead of once per file, which saves the import cost.
      { extends: true, test: { name: 'unit-shared', include: SHARED_UNIT_FILES, exclude: UNIT_EXCLUDE, isolate: false } },
      { extends: true, test: { name: 'e2e', include: E2E.map((p) => `src/${p}`) } },
      // The benches keep the DOM environment their recorded baselines were taken in.
      { extends: true, test: { name: 'perf', include: PERF, environment: 'jsdom' } },
    ],
  },
  // Asset imports resolve to file URLs as in the dev server; the cursor tests read the file names.
  build: { assetsInlineLimit: 0 },
});
