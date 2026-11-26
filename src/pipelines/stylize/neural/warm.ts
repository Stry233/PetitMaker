/** What the page prefetches for the on-device illustration: its worker's entry in the build's
 *  worker manifest, and the runtime and weights its first take loads in this browser. */
import { PROC_PACK_META } from '../proc/packs/manifest';
import { neuralBackendGuess } from './backend';
import { MODEL_URLS } from './models';
import { ORT_FILES } from './runtime-files';

/** The inference worker's module, as the build's worker manifest names it. */
export const NEURAL_WORKER_ENTRY = 'pipelines/stylize/neural/neural.worker.ts';

/** The runtime this engine is likely to run and the first neural style's weights; nothing where the
 *  engine cannot run the students. The capability probe loads with the call, never with the page. */
export async function neuralWarmUrls(): Promise<string[]> {
  const { neuralPacksUsable } = await import('./capability');
  if (!(await neuralPacksUsable())) return [];
  const runtime = ORT_FILES[neuralBackendGuess()];
  const style = PROC_PACK_META.find((pack) => pack.neural)?.neural;
  return [runtime.mjs, runtime.wasm, ...(style ? [MODEL_URLS[style]] : [])];
}
