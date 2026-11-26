/** What the page prefetches for the content check: its workers' entries in the build's worker
 *  manifest, and the runtime binaries and data the map check loads in this browser. */
import { MAP_CHECK_DATA, mapCheckAssetBase, mapCheckRuntimeUrls } from './assets';

/** The map check's and the text check's worker modules, as the build's worker manifest names them. */
export const CONTENT_CHECK_WORKER_ENTRIES: readonly string[] = ['pipelines/moderation/map/review.worker.ts', 'pipelines/moderation/text/review.worker.ts'];

/** The one variant of each runtime binary this engine loads, then the check's data. The SIMD probe
 *  loads with the call, never with the page. */
export async function mapCheckWarmUrls(): Promise<string[]> {
  const simd = await import('wasm-feature-detect').then((probe) => probe.simd()).catch(() => false);
  const base = mapCheckAssetBase();
  return [...mapCheckRuntimeUrls(simd), ...MAP_CHECK_DATA.map((file) => new URL(file, base).href)];
}
