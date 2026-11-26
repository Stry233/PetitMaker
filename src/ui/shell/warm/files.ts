/**
 * The first-use files the warm schedule fetches into the HTTP cache: what a surface would otherwise
 * download the first time it opens. Bytes only; each runtime is decoded by its own surface on use.
 *
 * A module worker's chunks are named by the build (`__PETIT_WORKER_FILES__`, see
 * `scripts/warm-build.mts`) under the entry its pipeline names; its binaries come from the pipeline
 * that owns their choice, so only the variant this engine will run is fetched. The main-thread text check fallback is never fetched: an
 * engine that needs it is not worth the 1.5 MB on every other visit. Files under a stable public name
 * (the logo) stay out: they revalidate on every use, so a prefetch would cost a request every visit.
 */
import type { WarmTier } from '../../../platform/device/device-quality';
import { SUPPORTS_VIDEO_IMPORT } from '../../../platform/build/edition';
import { playsVideo } from '../../../platform/device/video-format';
import { CONTENT_CHECK_WORKER_ENTRIES, mapCheckWarmUrls } from '../../../pipelines/moderation/map-facts';
import { VIDEO_WORKER_ENTRIES } from '../../../pipelines/planet-scan/facts';
import { NEURAL_WORKER_ENTRY, neuralWarmUrls } from '../../../pipelines/stylize/file-facts';
import { allStyleSampleUrls } from '../../../assets/style-sample-urls';
import { SCAN_EXAMPLE } from '../../chrome/modals/planet/scan-example';
import { EDITION_WARM_FILES } from '../edition-surfaces';
import { tourWarmFiles } from '../../chrome/tour/use-tour';

interface WorkerFiles { chunks: string[]; assets: string[] }

/** Each module worker's output files, base-relative; empty outside a web build. */
function workerFiles(): Readonly<Record<string, WorkerFiles>> {
  const encoded = typeof __PETIT_WORKER_FILES__ === 'string' ? __PETIT_WORKER_FILES__ : '';
  if (!encoded) return {};
  try { return JSON.parse(atob(encoded)) as Record<string, WorkerFiles>; } catch { return {}; }
}

const siteUrl = (file: string): string => `${import.meta.env.BASE_URL}${file}`;

const playsWebm = (): boolean => playsVideo('video/webm');

interface WarmFiles {
  /** Fetched with the schedule's counted items (inside the cold splash). */
  counted: string[];
  /** Fetched after them, one at a time, never holding the splash: the content check's code, runtime
   *  and data, then the illustration runtime and its default weights. */
  background: string[];
}

/** The illustration worker is fetched on the full tier only, the content check's workers on every
 *  warming tier, both in the background, since no surface of the editor's first screen runs either;
 *  the planet video import's workers only where the edition can import a video. */
export async function warmFiles(tier: WarmTier): Promise<WarmFiles> {
  if (tier === 'none' || tier === 'minimal') return { counted: [], background: [] };
  const workers = workerFiles();
  const chunksOf = (entry: string): string[] => workers[entry]?.chunks.map(siteUrl) ?? [];
  const counted = [
    ...Object.entries(workers)
      .filter(([entry]) => entry !== NEURAL_WORKER_ENTRY && !CONTENT_CHECK_WORKER_ENTRIES.includes(entry)
        && (SUPPORTS_VIDEO_IMPORT || !VIDEO_WORKER_ENTRIES.includes(entry)))
      .flatMap(([, files]) => files.chunks.map(siteUrl)),
    ...allStyleSampleUrls(),
    ...EDITION_WARM_FILES,
    // The tour opens as the loading screen lifts, so its opening card arrives whole with the editor.
    ...tourWarmFiles(),
    ...(SUPPORTS_VIDEO_IMPORT ? [SCAN_EXAMPLE.poster, playsWebm() ? SCAN_EXAMPLE.webm : SCAN_EXAMPLE.mp4] : []),
  ];
  const background = [...CONTENT_CHECK_WORKER_ENTRIES.flatMap(chunksOf), ...await mapCheckWarmUrls()];
  if (tier === 'full') {
    const neural = await neuralWarmUrls();
    if (neural.length > 0) background.push(...chunksOf(NEURAL_WORKER_ENTRY), ...neural);
  }
  const unique = (urls: string[]) => [...new Set(urls)].filter((url) => !url.startsWith('data:'));
  const countedUrls = unique(counted);
  // A chunk the counted workers share is fetched once, with them.
  return { counted: countedUrls, background: unique(background).filter((url) => !countedUrls.includes(url)) };
}
