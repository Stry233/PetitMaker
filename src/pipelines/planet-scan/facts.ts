// The planet video import's light facts, for callers that must not pull the pipeline into the eager
// bundle: the container signatures a file is recognised by. The scan profile is not one of them,
// since it carries the calibration.
export { ISO_FIRST_BOXES, opensEbml } from './media/container';
