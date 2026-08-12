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

/**
 * Whether a region is ONE figure or a collection of them.
 *
 * The generators that read a region as an AREA are happy with any number of patches; the ones that
 * FILL it are not. A picture is fitted to the region's bounding box, so two patches far apart give a
 * box spanning both with the picture drawn across the gap, and a second stroke meant as a correction
 * silently doubles the space instead. In single mode a stroke REPLACES what was there.
 *
 * A module setting rather than a prop, for the same reason the handler is one: the screen that knows
 * which generator is running and the buffer that collects the cells never meet.
 */
let single = false;

export function setRegionSingle(next: boolean): void { single = next; }
export function isRegionSingle(): boolean { return single; }

/**
 * The shortest side a drawn figure may come out at, or null for no floor.
 *
 * A HARD LIMIT AT CREATION: the rect and circle drags clamp their extent to it, so a figure below
 * the floor cannot be drawn at all — the drag simply refuses to shrink past it. The consumers that
 * set it are the ones whose output degrades below some size (the picture generators, whose stencil
 * is exactly as many cells as the region).
 */
let minSide: number | null = null;

export function setRegionMinSide(next: number | null): void { minSide = next; }
export function regionMinSide(): number | null { return minSide; }
