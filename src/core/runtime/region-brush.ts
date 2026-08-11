/**
 * The region-selection channel.
 *
 * Whatever is collecting a painted region registers here, and everything that edits that region as
 * a WHOLE goes through the same handle: the pointer machine reports the cells a stroke covers, and
 * the screen that arms it asks for the two edits a stroke cannot make — empty it, or take every
 * buildable cell. With nothing registered the calls are no-ops.
 *
 * They belong together because the collector owns the buffer AND its own undo stack: a UI that
 * wrote the store directly would leave that buffer stale and the stroke it took back unrecoverable.
 * The pointer machine's own `regionBrushing` (from `resolvePress`) gates on `store.selectingRegion`,
 * not on whether a handler is registered here — this channel only carries the cells once that gate
 * is already open.
 */
import type { MacroCoord } from '../model/types';

export interface RegionBrushHandler {
  paint(coord: MacroCoord): void;
  done(): void;
  /** Empty the region, as one entry on its own undo stack. */
  clear(): void;
  /** Take every cell a region may hold, which is every buildable one on the map. */
  selectAll(): void;
}

let handler: RegionBrushHandler | null = null;

/** Register for as long as region selection is on; returns its unregister. A stale unregister is
 *  ignored, so a remount that registers before the old one tears down keeps the newer handler. */
export function setRegionBrushHandler(next: RegionBrushHandler | null): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function paintRegionCell(coord: MacroCoord): void { handler?.paint(coord); }
export function finishRegionStroke(): void { handler?.done(); }
export function clearRegionSelection(): void { handler?.clear(); }
export function selectWholeRegion(): void { handler?.selectAll(); }
