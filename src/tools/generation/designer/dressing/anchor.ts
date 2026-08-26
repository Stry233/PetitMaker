/**
 * The BUILDING-ANCHOR regions dressed: a region where the building comes first and the place is
 * composed around it.
 *
 * The style target is what these styles are cut to: the planting beside a building is a SMALL NUMBER
 * OF SPECIES REPEATED, not a mixture (1 to 7 distinct species within three cells of a footprint,
 * median 2.5), and where trees appear they appear in counts of eight —
 * four each side of a mirrored pair. So an anchor region plants less than a theme region and repeats
 * itself more.
 *
 * THE HEDGE is the one element that is not tiled: a run of one species tracing each building's
 * outline one cell out, which is the garden ring a home reads with. It is laid before the tiling and
 * the tiling fills what is left, so a house always carries its own frame even where the region's
 * ground is too broken for a block.
 */
import type { Rng } from '../../../../core/model/rng';
import type { Rect } from '../../../../core/model/types';
import type { AnchorKind } from '../types';
import { inCanvas, type KitCanvas, type KitStyle, type PlantMark } from './types';

export function anchorStyle(kind: AnchorKind, rng: Rng): KitStyle {
  switch (kind) {
    // 住宅区 — homes with gardens between them: hedges, a bed or two, shade.
    case 'residential':
      return {
        tile: { w: 4, h: 4 }, appetite: 0.6,
        mix: [['border', 2], ['bed', 2], ['open', 4], ['grove', 3]],
      };
    // 自家住宅 — the player's own, and the one private garden on the map.
    case 'own-house':
      return {
        tile: { w: 4, h: 5 }, appetite: 0.7,
        mix: [['bed', 3], ['border', 1], ['open', 3], ['grove', 2]],
      };
    // 博物馆区 — a visited building: a forecourt to arrive in, planting held to the sides.
    case 'museum':
      return {
        tile: { w: 5, h: 5 }, appetite: 0.8, aisle: true,
        mix: [['border', 2], ['bed', 3], ['open', 3], ['orchard', 2]],
      };
    // 商店区 — the case rings it with a one-layer terrace; the ground inside stays walkable.
    case 'shop':
      return {
        tile: { w: 5, h: 5 }, appetite: 0.7, ring: rng.int(2) === 0,
        mix: [['border', 2], ['bed', 2], ['open', 4], ['grove', 2]],
      };
  }
}

/** The ring of one species one cell out from each building, on the cells the canvas offers. */
export function hedgeMarks(canvas: KitCanvas, buildings: readonly Rect[]): PlantMark[] {
  const catalogId = canvas.palette.species('edge');
  if (!catalogId) return [];
  const out: PlantMark[] = [];
  const seen = new Set<number>();
  for (const b of buildings) {
    for (let y = b.y - 1; y <= b.y + b.h; y++) {
      for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x > b.x - 1 && x < b.x + b.w && y > b.y - 1 && y < b.y + b.h) continue;
        const i = y * canvas.W + x;
        if (seen.has(i) || !inCanvas(canvas, x, y)) continue;
        seen.add(i);
        out.push({ x, y, catalogId });
      }
    }
  }
  return out;
}
