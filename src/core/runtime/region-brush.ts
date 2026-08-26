/**
 * The region-selection channel.
 *
 * Whatever is collecting a painted region registers here, and everything that edits that region as
 * a WHOLE goes through the same handle: the pointer machine reports the cells a stroke covers, and
 * the screen that arms it asks for the one edit a stroke cannot make — emptying it. An empty
 * region already means the whole island, so there is no take-everything edit beside it. With
 * nothing registered the calls are no-ops.
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

/** How big the map is, for the two helpers below. */
export interface MapExtent { w: number; h: number }

/**
 * A dragged BOX slid back onto the map, keeping the size it was grown to.
 *
 * WHY IT SLIDES RATHER THAN CLIPS. A figure with a minimum side is grown in the drag's own
 * direction, and a drag that starts near an edge grows straight off the map: the cells beyond it are
 * dropped and the region arrives SHORT of the floor that pushed it there, so the drag can never
 * satisfy its own minimum however far it is pulled. At an edge there is only one direction left, so
 * the whole figure moves that way instead. A box wider than the map has nowhere to go and sits at
 * its edge, clipped — which is the one case where the floor genuinely cannot be met.
 */
export function slideOnMap(
  anchor: { x: number; y: number }, end: { x: number; y: number }, map: MapExtent,
): { anchor: { x: number; y: number }; end: { x: number; y: number } } {
  const shift = (a: number, b: number, size: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const back = hi > size - 1 ? size - 1 - hi : 0;
    return lo + back < 0 ? -lo : back;
  };
  const dx = shift(anchor.x, end.x, map.w), dy = shift(anchor.y, end.y, map.h);
  return {
    anchor: { x: anchor.x + dx, y: anchor.y + dy },
    end: { x: end.x + dx, y: end.y + dy },
  };
}

/** The same for a figure drawn from its CENTRE: the centre moved in far enough that a radius fits
 *  either side of it, or held at the middle where the figure is wider than the map. */
export function clampCentre(centre: number, radius: number, size: number): number {
  const lo = radius, hi = size - 1 - radius;
  if (hi < lo) return (size - 1) >> 1;
  return Math.min(hi, Math.max(lo, centre));
}
