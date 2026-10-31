/**
 * The one startup warm schedule: every lazy chunk and first-use file the normal flow would otherwise
 * load just in time, fetched once per page in priority order, at most two at a time.
 *
 * A cold visit runs it inside the splash, which counts its items; a warm visit (no splash) starts it
 * after the editor's first paint. Either way it is the same run: whichever asks first starts it and
 * the other joins. Code is loaded through the same memoized loaders its surfaces use; files only
 * reach the HTTP cache. `warmTier()` decides how much a device takes on, and the background files (the
 * content check's, then the illustration runtime's on the full tier) follow the counted items without
 * holding the splash, beside the catalog icons' decodes on every tier (`decodeImage` decodes each
 * once per page, so the icons a splash already decoded cost nothing again).
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
import { decodeImage, prefetchIntoCache } from '../../../platform/async/http-cache';
import { allIconUrls } from '../../../assets/icon-urls';

const CONCURRENCY = 2;
/** How many catalog icons decode at once in the background. */
const DECODE_CONCURRENCY = 3;
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
function nextIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(resolve, 0);
  });
}

/** Runs `tasks` in order, at most `limit` at a time, calling `settled` after each; never rejects.
 *  The first task starts at once; each later one waits for `gate`. */
async function runLimited<T extends { run: Task }>(
  tasks: readonly T[], limit: number, settled: (task: T) => void, gate: () => Promise<void> = nextIdle,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const first = next === 0;
      const task = tasks[next++]!;
      if (!first) await gate();
      try { await task.run(); } catch { /* the surface reports its own failure when it opens */ }
      settled(task);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane));
}

/** One counted item of the run. */
export interface WarmItem {
  /** The file it fetches; a code item (a lazy chunk's loader) has none. */
  readonly url?: string;
}

interface Job extends WarmItem { readonly run: Task }

/** The item a job counts as, without its task. */
const itemOf = ({ url }: Job): WarmItem => Object.freeze(url === undefined ? {} : { url });

export interface WarmRun {
  /** The counted items, in order; known once `planned` resolves. */
  items(): readonly WarmItem[];
  /** The counted items settled so far, in the order they settled. */
  settledItems(): readonly WarmItem[];
  /** Resolves once the counted items are known. */
  readonly planned: Promise<void>;
  /** Resolves once every counted item has settled; never rejects. */
  readonly settled: Promise<void>;
  /** Called with each counted item as it settles; returns the unsubscribe. */
  subscribe(listener: (item: WarmItem) => void): () => void;
  /** Starts each counted item without waiting for an idle moment until the returned release, for a
   *  screen that waits on them: an engine may grant idle time rarely (Zen: once a second). */
  rush(): () => void;
}

function createRun(tier: WarmTier): WarmRun {
  const listeners = new Set<(item: WarmItem) => void>();
  let jobs: Job[] = [];
  const done: WarmItem[] = [];
  const tick = (job: Job): void => {
    const item = itemOf(job);
    done.push(item);
    for (const listener of listeners) listener(item);
  };
  let rushes = 0;
  /** Counted items waiting for an idle moment, released at once by `rush`. */
  const idling = new Set<() => void>();
  const gate = (): Promise<void> => (rushes > 0 ? Promise.resolve() : new Promise((resolve) => {
    const go = (): void => { idling.delete(go); resolve(); };
    idling.add(go);
    void nextIdle().then(go);
  }));
  let plan!: () => void;
  const planned = new Promise<void>((resolve) => { plan = resolve; });
  const settled = (async () => {
    const code = codeTasks(tier);
    const files = await warmFiles(tier).catch(() => ({ counted: [], background: [] }));
    const fetchJob = (url: string): Job => ({ url, run: () => prefetchIntoCache(url) });
    jobs = [...code.map((run): Job => ({ run })), ...files.counted.map(fetchJob)];
    plan();
    await runLimited(jobs, CONCURRENCY, tick, gate);
    void runLimited(files.background.map(fetchJob), 1, () => {});
    const decodes = allIconUrls().filter((url) => !url.startsWith('data:')).map((url) => ({ run: () => decodeImage(url) }));
    void runLimited(decodes, DECODE_CONCURRENCY, () => {});
  })();
  return {
    items: () => jobs.map(itemOf),
    settledItems: () => [...done],
    planned,
    settled,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    rush: () => {
      rushes++;
      for (const go of [...idling]) go();
      let held = true;
      return () => { if (held) { held = false; rushes--; } };
    },
  };
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
