// The experimental layout condition: a flat-color segmentation image aligned to the SAME
// letterbox frame the map capture lands in (see normalize.ts), so a generation call that sends
// both images never sees them disagree on where anything is.
import { ItemCategory, TerrainType, type GridState } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';
import { footprintCells, objectRect } from '../../../state/object-geometry';
import type { NormalizePlan } from '../normalize';

/** The legend the prompt compiler's layout label describes; one source for both. */
export const LEGEND = {
  ground: '#EFE3B8', water: '#3B7BD4', road: '#B98A5A',
  building: '#D94F4F', plant: '#2E8B57', bridge: '#8A5AB9',
} as const;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Cells covered by any Road-category object's footprint — roads carry no terrain type of their
 *  own (see TerrainType), so their coverage is read off the object layer like any other object,
 *  but painted per-cell rather than as one rect since a road run's footprint is what a segment
 *  image cares about, not the individual placed pieces. */
function roadCells(state: GridState): Set<string> {
  const cells = new Set<string>();
  for (const obj of state.objects.values()) {
    if (categoryOf(obj) !== ItemCategory.Road) continue;
    const r = objectRect(obj);
    for (const c of footprintCells(r.x, r.y, r.w, r.h)) cells.add(cellKey(c.x, c.y));
  }
  return cells;
}

function categoryColor(category: ItemCategory | undefined): string | null {
  switch (category) {
    case ItemCategory.Building: return LEGEND.building;
    case ItemCategory.Tree:
    case ItemCategory.Flora: return LEGEND.plant;
    case ItemCategory.Bridge: return LEGEND.bridge;
    default: return null;
  }
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
    const color = categoryColor(categoryOf(obj));
    if (!color) continue;
    const r = objectRect(obj);
    ctx.fillStyle = color;
    ctx.fillRect(plan.offsetX + r.x * scaleX, plan.offsetY + r.y * scaleY, r.w * scaleX, r.h * scaleY);
  }

  return canvas;
}
