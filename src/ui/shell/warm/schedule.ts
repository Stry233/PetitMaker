/**
 * The one startup warm schedule: every lazy chunk and first-use file the normal flow would otherwise
 * load just in time, fetched once per page in priority order, at most two at a time.
 *
 * A cold visit runs it inside the splash, which counts its items; a warm visit (no splash) starts it
 * after the editor's first paint. Either way it is the same run: whichever asks first starts it and
 * the other joins. Code is loaded through the same memoized loaders its surfaces use; files only
 * reach the HTTP cache. `warmTier()` decides how much a device takes on, and the on-device
 * illustration runtime (full tier) follows the counted items without holding the splash.
 */
import { hasWebGL2, warmTier, type WarmTier } from '../../../platform/device/device-quality';
import { SUPPORTS_VIDEO_IMPORT } from '../../../platform/build/edition';
import { loadScene3D } from '../../../view/map3d/scene/preload';
import { roadMaterialSettled } from '../../../view/shared/road/material';
import { loadProcRenderer, loadNeuralSession } from '../../../pipelines/stylize/loaders';
import { loadHelpModal, loadPanelColumn, loadStylizeWindow, loadWhatsThisLayer } from '../edition-surfaces';
import { loadLegalDocView, loadMapRenderer, loadPlanetImportWindow, loadPreview3D } from '../../chrome/loaders';
import { loadNewTagCard } from './loaders';
import { warmFiles } from './files';
import { prefetchIntoCache } from '../../../platform/async/http-cache';

const CONCURRENCY = 2;
/** The longest an item waits for an idle moment before it starts anyway. */
const IDLE_TIMEOUT_MS = 2000;

type Task = () => Promise<unknown>;

/** The code a tier warms, in the order the normal flow reaches it: the 3D view (scene and model
 *  table) and the road clipper it draws with, Help, the assistant, the export and illustration
 *  windows, the video import, then the rest. */
function codeTasks(tier: WarmTier): Task[] {
  if (tier === 'none') return [];
  const view3d: Task[] = hasWebGL2() ? [loadScene3D] : [];
  const help: Task[] = [loadHelpModal, loadWhatsThisLayer, loadMapRenderer];
  if (tier === 'minimal') return [...view3d, ...help];
  return [
    ...view3d, roadMaterialSettled,
    ...help,
    loadPanelColumn,
    loadPreview3D, loadStylizeWindow, loadProcRenderer, loadNeuralSession,
    ...(SUPPORTS_VIDEO_IMPORT ? [loadPlanetImportWindow] : []),
    loadLegalDocView, loadNewTagCard,
  ];
}

/** Resolves at the browser's next idle moment (a timer where there is no idle callback), so a warm
 *  item never starts inside a long task such as the 3D view's first build. */
export function nextIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(resolve, 0);
  });
}

/** Runs `tasks` in order, at most `limit` at a time, calling `settled` after each; never rejects.
 *  The first task starts at once; each later one waits for `gate`. */
async function runLimited(tasks: readonly Task[], limit: number, settled: () => void, gate: () => Promise<void> = nextIdle): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const first = next === 0;
      const task = tasks[next++]!;
      if (!first) await gate();
      try { await task(); } catch { /* the surface reports its own failure when it opens */ }
      settled();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane));
}

export interface WarmRun {
  /** Counted items; known once `planned` resolves. */
  total(): number;
  /** Counted items settled so far. */
  done(): number;
  /** Resolves once the counted items are known. */
  readonly planned: Promise<void>;
  /** Resolves once every counted item has settled; never rejects. */
  readonly settled: Promise<void>;
  /** Called after each counted item settles; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

function createRun(tier: WarmTier): WarmRun {
  const listeners = new Set<() => void>();
  let total = 0;
  let done = 0;
  const tick = (): void => { done++; for (const listener of listeners) listener(); };
  let plan!: () => void;
  const planned = new Promise<void>((resolve) => { plan = resolve; });
  const settled = (async () => {
    const code = codeTasks(tier);
    const files = await warmFiles(tier).catch(() => ({ counted: [], background: [] }));
    total = code.length + files.counted.length;
    plan();
    const fetchTask = (url: string): Task => () => prefetchIntoCache(url);
    await runLimited([...code, ...files.counted.map(fetchTask)], CONCURRENCY, tick);
    void runLimited(files.background.map(fetchTask), 1, () => {});
  })();
  return { total: () => total, done: () => done, planned, settled, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } };
}

let run: WarmRun | null = null;

/** The page's warm run, started on first call. */
export function startWarm(): WarmRun {
  return run ??= createRun(warmTier());
}

/** Test hook: forget the page's run. */
export function __resetWarm(): void {
  run = null;
}
