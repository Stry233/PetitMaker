/**
 * The door: the plan-notes tool as callers outside `tools/` take it. Modules inside `tools/`
 * import files directly; everything else comes through here.
 */
export { AnnotateTool } from './annotate-tool';
export { CHIP_TEXT_SIZES, ZONE_TEXT_SIZES } from './facts';
