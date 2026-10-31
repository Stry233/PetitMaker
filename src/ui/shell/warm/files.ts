/**
 * The first-use files the warm schedule fetches into the HTTP cache: what a surface would otherwise
 * download the first time it opens. Bytes only; each runtime is decoded by its own surface on use.
 *
 * A module worker's chunks are named by the build (`__PETIT_WORKER_FILES__`, see
 * `scripts/warm-build.mts`); its binaries come from the module that owns their choice, so only the
 * variant this engine will run is fetched. The main-thread text check fallback is never fetched: an
 * engine that needs it is not worth the 1.5 MB on every other visit. Files under a stable public name
 * (the logo) stay out: they revalidate on every use, so a prefetch would cost a request every visit.
 */
import type { WarmTier } from '../../../platform/device/device-quality';
import { SUPPORTS_VIDEO_IMPORT } from '../../../platform/build/edition';
import { playsVideo } from '../../../platform/device/video-format';
import { MAP_CHECK_DATA, mapCheckAssetBase, mapCheckRuntimeUrls } from '../../../pipelines/moderation/map-facts';
import { PROC_PACK_META } from '../../../pipelines/stylize/facts';
import { MODEL_URLS, ORT_FILES } from '../../../pipelines/stylize/file-facts';
import { allStyleSampleUrls } from '../../chrome/modals/export/stylize/sample-assets';
import { SCAN_EXAMPLE } from '../../chrome/modals/planet/scan-example';
import { EDITION_WARM_FILES } from '../edition-surfaces';
import { tourWarmFiles } from '../../chrome/tour/use-tour';

interface WorkerFiles { chunks: string[]; assets: string[] }

/** The on-device illustration worker: fetched on the full tier only, in the background. */
const NEURAL_WORKER = 'pipelines/stylize/neural/neural.worker.ts';
/** The content check's workers: with its runtime binaries and data they are fetched in the
 *  background, since no surface of the editor's first screen runs a check. */
const CONTENT_CHECK_WORKERS = ['pipelines/moderation/map/review.worker.ts', 'pipelines/moderation/text/review.worker.ts'];
/** The planet video import's workers, fetched only where the edition can import a video. */
const VIDEO_WORKERS = ['pipelines/planet-scan/scan.worker.ts', 'pipelines/planet-scan/media/decode.worker.ts'];

/** Each module worker's output files, base-relative; empty outside a web build. */
function workerFiles(): Readonly<Record<string, WorkerFiles>> {
  const encoded = typeof __PETIT_WORKER_FILES__ === 'string' ? __PETIT_WORKER_FILES__ : '';
  if (!encoded) return {};
  try { return JSON.parse(atob(encoded)) as Record<string, WorkerFiles>; } catch { return {}; }
}

const siteUrl = (file: string): string => `${import.meta.env.BASE_URL}${file}`;

async function hasSimd(): Promise<boolean> {
  try { return await (await import('wasm-feature-detect')).simd(); } catch { return false; }
}

const playsWebm = (): boolean => playsVideo('video/webm');

export interface WarmFiles {
  /** Fetched with the schedule's counted items (inside the cold splash). */
  counted: string[];
  /** Fetched after them, one at a time, never holding the splash: the content check's code, runtime
   *  and data, then the illustration runtime and its default weights. */
  background: string[];
}

export async function warmFiles(tier: WarmTier): Promise<WarmFiles> {
  if (tier === 'none' || tier === 'minimal') return { counted: [], background: [] };
  const workers = workerFiles();
  const simd = await hasSimd();
  const base = mapCheckAssetBase();
  const counted = [
    ...Object.entries(workers)
      .filter(([entry]) => entry !== NEURAL_WORKER && !CONTENT_CHECK_WORKERS.includes(entry)
        && (SUPPORTS_VIDEO_IMPORT || !VIDEO_WORKERS.includes(entry)))
      .flatMap(([, files]) => files.chunks.map(siteUrl)),
    ...allStyleSampleUrls(),
    ...EDITION_WARM_FILES,
    // The tour opens as the loading screen lifts, so its opening card arrives whole with the editor.
    ...tourWarmFiles(),
    ...(SUPPORTS_VIDEO_IMPORT ? [SCAN_EXAMPLE.poster, playsWebm() ? SCAN_EXAMPLE.webm : SCAN_EXAMPLE.mp4] : []),
  ];
  const background = [
    ...CONTENT_CHECK_WORKERS.flatMap((entry) => workers[entry]?.chunks.map(siteUrl) ?? []),
    ...mapCheckRuntimeUrls(simd),
    ...MAP_CHECK_DATA.map((file) => new URL(file, base).href),
  ];
  if (tier === 'full' && simd) {
    const backend = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    const style = PROC_PACK_META.find((pack) => pack.neural)?.neural;
    background.push(
      ...(workers[NEURAL_WORKER]?.chunks.map(siteUrl) ?? []),
      ORT_FILES[backend].mjs, ORT_FILES[backend].wasm,
      ...(style ? [MODEL_URLS[style]] : []),
    );
  }
  const unique = (urls: string[]) => [...new Set(urls)].filter((url) => !url.startsWith('data:'));
  const countedUrls = unique(counted);
  // A chunk the counted workers share is fetched once, with them.
  return { counted: countedUrls, background: unique(background).filter((url) => !countedUrls.includes(url)) };
}
