// The experimental layout condition: a flat-color segmentation image aligned to the same
// letterbox frame the map capture lands in (see normalize.ts), so a generation call that sends
// both images never sees them disagree on where anything is.
import { TerrainType, type CatalogItem, type GridState } from '../../../core/model/types';
import { isBridge, isCoatingItem } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { stylizeElementOf } from '../scene/element';
import { objectRect } from '../../../state/object-geometry';
import { footprintCells } from '../../../core/grid/footprint';
import { cellKey } from '../../../core/grid/rect';
import type { NormalizePlan } from '../normalize';
import { LEGEND } from './legend';


/** Cells covered by any road surface's footprint — roads carry no terrain type of their
 *  own (see TerrainType), so their coverage is read off the object layer like any other object,
 *  but painted per-cell rather than as one rect since a road run's footprint is what a segment
 *  image cares about, not the individual placed pieces. */
function roadCells(state: GridState): Set<string> {
  const cells = new Set<string>();
  for (const obj of state.objects.values()) {
    if (!isCoatingItem(getCatalogItem(obj.catalogId))) continue;
    const r = objectRect(obj);
    for (const c of footprintCells(r.x, r.y, r.w, r.h)) cells.add(cellKey(c.x, c.y));
  }
  return cells;
}

/** The legend colour an object fills its footprint with: homes, plants and bridges; null for the rest. */
function objectColor(item: CatalogItem | undefined): string | null {
  const element = stylizeElementOf(item);
  if (element === 'building') return LEGEND.building;
  if (element === 'plant') return LEGEND.plant;
  return isBridge(item) ? LEGEND.bridge : null;
}

export function renderSemanticLayout(state: GridState, plan: NormalizePlan): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(plan.frameW);
  canvas.height = Math.round(plan.frameH);
  const ctx = canvas.getContext('2d')!;

  // Ground fills the whole frame first, so the letterbox bars read as ground with no special case.
  ctx.fillStyle = LEGEND.ground;
  ctx.fillRect(0, 0, plan.frameW, plan.frameH);

  const { template } = state;
  const scaleX = plan.drawW / template.width;
  const scaleY = plan.drawH / template.height;
  const roads = roadCells(state);

  for (let y = 0; y < template.height; y++) {
    const row = state.cells[y];
    for (let x = 0; x < template.width; x++) {
      const terrain = row?.[x]?.terrain;
      const isWater = !!terrain && terrain.type === TerrainType.Water;
      const isRoad = !isWater && roads.has(cellKey(x, y));
      if (!isWater && !isRoad) continue;
      ctx.fillStyle = isWater ? LEGEND.water : LEGEND.road;
      ctx.fillRect(plan.offsetX + x * scaleX, plan.offsetY + y * scaleY, scaleX, scaleY);
    }
  }

  for (const obj of state.objects.values()) {
    const color = objectColor(getCatalogItem(obj.catalogId));
    if (!color) continue;
    const r = objectRect(obj);
    ctx.fillStyle = color;
    ctx.fillRect(plan.offsetX + r.x * scaleX, plan.offsetY + r.y * scaleY, r.w * scaleX, r.h * scaleY);
  }

  return canvas;
}
