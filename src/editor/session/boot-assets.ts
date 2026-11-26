/**
 * The boot's assets: a cold visit warms the interface art, then registers the shipped font faces and
 * loads the first screen's, and records that this browser holds the build; a visit whose files are
 * cached registers the faces before its first render. The splash draws the run's progress and
 * nothing here needs it mounted: every canvas, stencil and export that sets text relies on the
 * faces this module registers.
 */
import { activeTarget } from '../../platform/build/deploy-targets';
import { allIconUrls } from '../../assets/icon-urls';
import { INTERFACE_FACE } from '../../assets/fonts/family';
import { FONT_FILES, fontFaceRegistered, installFontFaces, loadFontFace } from '../../assets/fonts/faces';
import { shouldShowSplash } from '../../io/storage/splash-facts';
import { cacheHolds, decodeImage, fetchIntoCache } from '../../platform/async/http-cache';
import { loadWeights } from './boot-weights';
import { markSplashDone } from './visit-marks';

/** One counted item of the page's warm schedule. */
export interface WarmItem {
  /** The file it fetches; a code item (a lazy chunk's loader) has none. */
  readonly url?: string;
}

/** The page's warm schedule as the run reads it. The schedule itself is the interface's, since it
 *  names the interface's lazy chunks, so the run takes it as an argument. */
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

/** The faces the editor's first screen sets text in, which the run waits for; the others load
 *  after it. */
const FIRST_FRAME_FONTS = FONT_FILES.filter(({ family }) => family === INTERFACE_FACE);
const LATER_FONTS = FONT_FILES.filter(({ family }) => family !== INTERFACE_FACE);

const FETCH_POOL = 8;

/** Bytes arrived and bytes counted (`boot-weights.ts`); a fetched file moves it as its body streams, and a
 *  failed item counts its full weight once it settles. */
type Progress = (done: number, total: number) => void;

/** One run per page, multiplexed: React's dev StrictMode mounts the splash twice, and the
 *  remount must attach to the run already in flight (getting the current count at once) rather
 *  than starting a second sweep or, worse, being the run nobody finishes. */
let inflight: Promise<boolean> | null = null;
const subscribers = new Set<Progress>();
let lastDone = 0;
let lastTotal = 0;
/** The first screen's font downloads still running, by URL. */
const fontFetches = new Map<string, Promise<unknown>>();
/** The boot's cache answer (`cacheWarmAtBoot`), asked once per page. */
let bootCheck: Promise<boolean> | null = null;
let bootAnswer: boolean | null = null;

/**
 * Fetch everything, reporting `(done, total)` in bytes after each settled item. The art goes first;
 * the font faces register only once it has settled (`assets/fonts/faces.ts`), so on a slow link the
 * fonts never starve it. The first screen's fonts and the warm schedule's counted items (lazy chunks
 * and first-use files) count too; `startWarm` starts or joins the page's schedule. Resolves whether
 * all art and those fonts completed successfully within the warmup deadline, which the run records
 * for the next visit (`visit-marks.ts:markSplashDone`); never rejects. The warm schedule and the font
 * downloads keep running past the deadline, and their failures never make a later visit show the
 * splash again.
 */
export function warmBootAssets(startWarm: () => WarmRun, onProgress: Progress, signal?: AbortSignal): Promise<boolean> {
  if (!signal?.aborted) subscribers.add(onProgress);
  const unsubscribe = () => subscribers.delete(onProgress);
  signal?.addEventListener('abort', unsubscribe, { once: true });
  if (lastTotal > 0 && !signal?.aborted) onProgress(lastDone, lastTotal);
  inflight ??= runBootAssets(startWarm).then((complete) => {
    if (complete) markSplashDone();
    return complete;
  });
  return inflight.finally(() => {
    unsubscribe();
    signal?.removeEventListener('abort', unsubscribe);
  });
}

async function runBootAssets(startWarm: () => WarmRun): Promise<boolean> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  // Whether the art and fonts completed, once they have settled: the deadline releases the run's
  // callers with that answer while the warm schedule carries on.
  let artComplete: boolean | null = null;
  // The warm run's counted items skip idle waits only while the run's callers wait.
  let unrush = (): void => {};
  const expired = new Promise<boolean>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve(artComplete ?? false); }, 30_000);
  });
  const work = async (): Promise<boolean> => {
    // The warm run starts while the manifest is on its way; items it settles meanwhile are counted at the join.
    const warm = startWarm();
    unrush = warm.rush();
    const [{ splashAssetUrls }, weigh] = await Promise.all([import('./boot-asset-list'), loadWeights(controller.signal)]);
    if (controller.signal.aborted) return false;
    const urls = splashAssetUrls();
    const icons = new Set(allIconUrls());
    const fonts = fontsLoadable() ? FIRST_FRAME_FONTS : [];
    await warm.planned;
    if (controller.signal.aborted) return false;
    const warmBytes = (item: WarmItem): number => weigh(item.url === undefined ? 'code' : 'file', item.url);
    lastTotal = sum(urls, (url) => weigh('art', url)) + sum(fonts, (face) => weigh('font', face.url)) + sum(warm.items(), warmBytes);
    lastDone = sum(warm.settledItems(), warmBytes);
    let complete = true;
    const settle = (bytes: number): void => {
      if (controller.signal.aborted) return;
      lastDone += bytes;
      for (const sub of subscribers) sub(lastDone, lastTotal);
    };
    const unsubscribeWarm = warm.subscribe((item) => settle(warmBytes(item)));
    controller.signal.addEventListener('abort', unsubscribeWarm, { once: true });
    /** Fetches one counted file, moving the bar as its body streams in; returns the bytes its
     *  weight still owes, which the caller settles once the file is ready. */
    const fetchCounted = async (url: string, kind: 'art' | 'font', signal?: AbortSignal): Promise<{ ok: boolean; owed: number }> => {
      let owed = weigh(kind, url);
      const ok = await fetchIntoCache(url, signal, (bytes) => {
        const step = Math.min(bytes, owed);
        if (step <= 0) return;
        owed -= step;
        settle(step);
      });
      return { ok, owed };
    };
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted && cursor < urls.length) {
        const url = urls[cursor++]!;
        const { ok, owed } = await fetchCounted(url, 'art', controller.signal);
        if (!ok) complete = false;
        else if (!controller.signal.aborted && icons.has(url) && !await decodeImage(url)) complete = false;
        settle(owed);
      }
    };
    await Promise.all(Array.from({ length: FETCH_POOL }, worker));
    // A face's file reaches the HTTP cache before the face registers: a registered face's file is
    // requested by the page's own text at once, through a loader this one cannot follow. A face
    // already registered is loading through the browser, so it is joined, never fetched again.
    // The fetches outlive the deadline: the face registers from a whole file, not a restarted one.
    await Promise.all(fonts.map(async (face) => {
      let owed = weigh('font', face.url);
      if (!fontFaceRegistered(face)) {
        const fetched = fetchCounted(face.url, 'font');
        fontFetches.set(face.url, fetched);
        const result = await fetched;
        fontFetches.delete(face.url);
        if (!result.ok) complete = false;
        owed = result.owed;
        installFontFaces([face]);
      }
      if (!await loadFontFace(face)) complete = false;
      settle(owed);
    }));
    artComplete = complete && !controller.signal.aborted;
    await warm.settled;
    unsubscribeWarm();
    return artComplete;
  };
  try { return await Promise.race([work().catch(() => false), expired]); }
  finally {
    clearTimeout(timeout!);
    unrush();
    subscribers.clear();
    // The hand-off: the faces register now at the latest (one still downloading once its file is
    // whole), and those the first screen does not show load behind it.
    for (const face of FONT_FILES) {
      const fetching = fontFetches.get(face.url);
      if (fetching) void fetching.then(() => { installFontFaces([face]); });
      else installFontFaces([face]);
    }
    if (fontsLoadable()) for (const face of LATER_FONTS) void loadFontFace(face);
  }
}

function fontsLoadable(): boolean {
  return typeof document !== 'undefined' && typeof FontFace !== 'undefined' && typeof (document.fonts as FontFaceSet | undefined)?.add === 'function';
}

function sum<T>(items: readonly T[], bytes: (item: T) => number): number {
  return items.reduce((total, item) => total + bytes(item), 0);
}

/** Test hook: forget the in-flight run and its subscribers. */
export function __resetBootAssets(): void {
  inflight = null;
  bootCheck = null;
  bootAnswer = null;
  fontFetches.clear();
  subscribers.clear();
  lastDone = 0;
  lastTotal = 0;
}

/**
 * Whether the browser's HTTP cache actually holds this build's assets; the flag alone cannot say,
 * since a hard reload (Ctrl+F5) and cache eviction both empty the cache while localStorage keeps it.
 * The probe reads the masthead the boot loader itself displays (per deploy target): it enumerates
 * nothing extra, and on a cold answer the run is about to want this exact file first.
 */
async function probeWarmCache(): Promise<boolean> {
  const url = `${import.meta.env.BASE_URL}${activeTarget().bootBanner}`;
  await bootLoaderImage(url);
  return cacheHolds(url);
}

/** Settles once the boot loader's own copy of `url` has loaded or failed (at most 3 s), so its
 *  timing entry, the one that says whether the navigation found the file cached, is recorded. */
function bootLoaderImage(url: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const href = new URL(url, location.href).href;
  const img = Array.from(document.images).find((image) => image.src === href);
  if (!img || img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    const done = (): void => { clearTimeout(timer); resolve(); };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
}

/** Whether this visit's files are cached, asked once per page: this build's flag, and when the flag
 *  says warm, the cache probe, since a hard reload or eviction empties the cache and keeps the flag. */
export function cacheWarmAtBoot(): Promise<boolean> {
  bootCheck ??= (shouldShowSplash() ? Promise.resolve(false) : probeWarmCache()).then((warm) => (bootAnswer = warm));
  return bootCheck;
}

/** Whether this visit is owed the splash as far as is known now: this build's flag says so, or the
 *  boot's cache answer has settled cold. A warm flag whose answer is still out reads as not owed;
 *  `cacheWarmAtBoot` settles it. */
export function splashOwedNow(): boolean {
  return shouldShowSplash() || bootAnswer === false;
}

/** Registers the font faces before the first render of a visit whose files are cached; a cold visit's
 *  run registers them after its art. Resolves once decided; never rejects. */
export function registerFontsIfWarm(): Promise<void> {
  return cacheWarmAtBoot().then((warm) => { if (warm) installFontFaces(); }, () => {});
}
