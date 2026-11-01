import { globSync, readFileSync, realpathSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Browser journeys, timing benches and the slow tier each run as their own project, outside `npm run test:run`.
const E2E = ['**/*.e2e.*'];
const PERF = ['src/__tests__/perf/**/*.perf.test.ts'];
/** Files that take ten seconds or more on a hosted runner; they run nightly and before a publication.
 *  A withheld one is `<name>.slow.internal.test.*`, keeping `.internal.test.` whole for the export. */
export const SLOW = ['src/**/*.slow.test.*', 'src/**/*.slow.internal.test.*', 'scripts/**/*.slow.test.*'];
// The public snapshot omits release-tooling tests, so the script patterns simply match nothing there.
const UNIT = ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mts', 'scripts/**/*.test.ts', 'scripts/**/*.test.tsx'];
export const UNIT_EXCLUDE = [...configDefaults.exclude, ...E2E, ...PERF, ...SLOW];

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
  .filter((p) => !/\.(e2e|slow)\./.test(p) && !NEEDS_ISOLATION.test(readFileSync(join(ROOT, p), 'utf8')))
  .sort();

/** A worktree links the main checkout's packages (`scripts/internal/worktree/setup.mts`), and Vite
 *  refuses to serve a file outside the root, so the folder holding the real `node_modules` is allowed. */
const PACKAGES_HOME = dirname(realpathSync(join(ROOT, 'node_modules')));

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [...new Set([ROOT, PACKAGES_HOME])] } },
  test: {
    globals: true,
    // A worker peaks near 0.8 GB, so twelve keep a full run near 10 GB; on a shared machine more
    // workers add contention faster than throughput. A hosted runner for a private repository has two
    // cores and runs nothing else, so CI takes them all.
    // PETIT_TEST_WORKERS caps a machine that runs several jobs at once (the private runner service).
    maxWorkers: Number(process.env.PETIT_TEST_WORKERS) || (process.env.CI ? availableParallelism() : Math.min(12, Math.max(1, availableParallelism() - 1))),
    // A hosted runner's two busy cores run a test three to four times slower than a workstation, and a
    // workstation under a browser campaign or a second suite slows as much; a load read at start misses
    // the load the run itself adds. Slowness belongs to the slow tier and the perf budgets, not to a
    // timeout that fails a correct test on a busy machine.
    testTimeout: process.env.CI ? 20_000 : 15_000,
    // Files that need a DOM open with a `// @vitest-environment jsdom` docblock; jsdom setup costs
    // most of a small file's run time, so it is not the default.
    environment: 'node',
    // `assets/fonts/faces.ts` reads the face declarations as `fonts.css?raw`, which Vitest would
    // otherwise empty like every CSS import it does not include.
    css: { include: [/assets\/fonts\/fonts\.css/] },
    setupFiles: ['./src/__tests__/_support/setup.ts'],
    // Transformed modules persist under node_modules/.vitest-cache, keyed by content, so a rerun skips the transform.
    fsModuleCache: true,
    onConsoleLog(log) {
      // Reduced-motion tests set the preference explicitly; Framer's device advisory is expected.
      if (log.startsWith('You have Reduced Motion enabled on your device.')) return false;
    },
    // Forked processes, not worker threads: under threads the files that open the assistant panel in
    // a beforeAll hang on the hosted Linux runners, while the two pools tie on a workstation.
    projects: [
      // `npm run test:run` runs both unit projects; together they hold every unit file exactly once.
      { extends: true, test: { name: 'unit-isolated', include: UNIT, exclude: [...UNIT_EXCLUDE, ...SHARED_UNIT_FILES] } },
      // Modules load once per worker instead of once per file, which saves the import cost.
      { extends: true, test: { name: 'unit-shared', include: SHARED_UNIT_FILES, exclude: UNIT_EXCLUDE, isolate: false } },
      { extends: true, test: { name: 'slow', include: SLOW, exclude: [...configDefaults.exclude, ...E2E, ...PERF] } },
      { extends: true, test: { name: 'e2e', include: E2E.map((p) => `src/${p}`) } },
      // The benches keep the DOM environment their recorded baselines were taken in.
      { extends: true, test: { name: 'perf', include: PERF, environment: 'jsdom' } },
    ],
  },
  // Asset imports resolve to file URLs as in the dev server; the cursor tests read the file names.
  build: { assetsInlineLimit: 0 },
});
