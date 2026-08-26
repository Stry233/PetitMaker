/**
 * The bench's shot builder: what a vision seat's `view_map` renders through the offline terrain
 * renderer. Pure data in, pure data out (no node imports): the bench owns the filesystem and the
 * python call, this file owns the geometry, so the crop and the wire shape are testable without
 * either.
 *
 * Every shot carries a `ruler` block the renderer burns into the image — axis labels and gridlines
 * in ABSOLUTE map coordinates (`x0`/`y0` re-base a crop's labels), because a render the model
 * cannot map back to the x,y it edits is a pretty picture, not a view.
 */
import type { TerrainArrays } from './dump';

export interface ShotRect { x1: number; y1: number; x2: number; y2: number }

export interface ShotRuler {
  /** Labeled major gridline interval, in cells. */
  step: number;
  /** Unlabeled minor gridline interval, in cells. */
  minor: number;
  /** Absolute map coordinate of the shot's top-left cell, what the labels count from. */
  x0: number;
  y0: number;
  /** Pixels per cell for this shot. */
  cellPx: number;
}

/** Corners sorted and clamped to a w×h map; null when the rect misses the map entirely. */
export function normalizeRect(rect: ShotRect, w: number, h: number): ShotRect | null {
  const x1 = Math.max(0, Math.min(rect.x1, rect.x2));
  const x2 = Math.min(w - 1, Math.max(rect.x1, rect.x2));
  const y1 = Math.max(0, Math.min(rect.y1, rect.y2));
  const y2 = Math.min(h - 1, Math.max(rect.y1, rect.y2));
  if (x2 < x1 || y2 < y1) return null;
  return { x1, y1, x2, y2 };
}

/** The rect's slice of the map (corners inclusive, assumed normalized): tier/water re-rastered to
 *  the crop, objects intersecting it re-based to its origin with any overhang clipped off. */
export function cropTerrain(t: TerrainArrays, rect: ShotRect): TerrainArrays {
  const w = rect.x2 - rect.x1 + 1;
  const h = rect.y2 - rect.y1 + 1;
  const tier: number[] = [], water: number[] = [];
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      const i = y * t.w + x;
      tier.push(t.tier[i] ?? 0);
      water.push(t.water[i] ?? -1);
    }
  }
  const objects = t.objects.flatMap((o) => {
    const ox1 = Math.max(o.x, rect.x1);
    const oy1 = Math.max(o.y, rect.y1);
    const ox2 = Math.min(o.x + o.w - 1, rect.x2);
    const oy2 = Math.min(o.y + o.h - 1, rect.y2);
    if (ox2 < ox1 || oy2 < oy1) return [];
    return [{ kind: o.kind, e: o.e, x: ox1 - rect.x1, y: oy1 - rect.y1, w: ox2 - ox1 + 1, h: oy2 - oy1 + 1 }];
  });
  return { tier, water, w, h, objects };
}

/** Labels every 10 cells (minor lines every 5, the same rhythm as the token ruler's tens row),
 *  cells scaled so the longest side lands near 720px: a whole hexia map (169 wide) keeps the
 *  renderer's native 4px, a small crop grows to at most 12px so its detail reads. */
export function rulerFor(w: number, h: number, x0 = 0, y0 = 0): ShotRuler {
  const cellPx = Math.min(12, Math.max(4, Math.floor(720 / Math.max(w, h))));
  return { step: 10, minor: 5, x0, y0, cellPx };
}

/** One map in the renderer's montage wire shape, the `ruler` block at the top level beside the
 *  hoisted dimensions. */
export function shotJson(t: TerrainArrays, label: string, ruler: ShotRuler): Record<string, unknown> {
  return {
    size: Math.max(t.w, t.h),
    cols: 1,
    w: t.w,
    h: t.h,
    ruler,
    maps: [{ row: 0, col: 0, label, tier: t.tier, water: t.water, objects: t.objects }],
  };
}
