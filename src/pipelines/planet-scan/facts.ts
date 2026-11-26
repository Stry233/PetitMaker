// The planet video import's light facts, for callers that must not pull the pipeline into the eager
// bundle: the container signatures a file is recognised by and its workers' entries. The scan
// profile is not one of them, since it carries the calibration.
export { ISO_FIRST_BOXES, opensEbml } from './media/container';

/** The scan's and the decoder's worker modules, as the build's worker manifest names them. */
export const VIDEO_WORKER_ENTRIES: readonly string[] = ['pipelines/planet-scan/scan.worker.ts', 'pipelines/planet-scan/media/decode.worker.ts'];
