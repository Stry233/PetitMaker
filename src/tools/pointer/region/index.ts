/** The door: the region-select brush and its pointer channel as callers outside `tools/` take them. */
export { createRegionBrush, type RegionBrush } from './region-brush';
export {
  cancelPendingRegion, cancelRegionStroke, clearRegionSelection, finishRegionStroke, paintRegionCell, previewRegionCell,
  setRegionBrushHandler, undoPendingRegionStep,
} from './channel';
