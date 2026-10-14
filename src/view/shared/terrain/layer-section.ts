/** A top-down picture of the map, one layer at a time: the cross-section the export's layer
 *  column shows, and the colour every flat map picture marks an object's footprint in. */
import { TerrainType, type GridState } from '../../../core/model/types';
import { ELEVATION_COLORS, WATER_COLOR } from '../../../core/model/palette';
import { ZONES } from '../../../core/game/profile';
import { fitAspect } from '../../../core/grid/rect';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { CATEGORY_BY_ID } from '../../../config/catalog/categories';
import { rrPath } from '../viewport/round-rect';

/** The mark of an object whose catalog item or category is unknown. */
const UNKNOWN_OBJECT_MARK = '#e6c48a';

/** The flat colour an object footprint is drawn in on a top-down picture of the map, by category. */
export function objectMarkColor(catalogId: string): string {
  const item = getCatalogItem(catalogId);
  return (item && CATEGORY_BY_ID.get(item.category)?.markColor) ?? UNKNOWN_OBJECT_MARK;
}

/** Draw one layer's cross-section at height `level` into `rect` (cumulative, like the 2D layer
 *  panel: a cell at elevation 3 occupies layers 1, 2 and 3). Browser-only (Canvas-2D).
 *  - The planet silhouette (zones) is the base: Full on the ground layer (it is the land),
 *    faint on higher layers (context behind that layer's tiles).
 *  - Level 0 (Ground): the land plus ground-level water (elevation 0) and ground objects.
 *  - Level N >= 1: every cell whose column reaches height N — a mountain with elevation >= N shows
 *    its slice (so a tall block still renders at the lower layers it passes through, not only at its
 *    top); elevated water shows its solid floor (mountain) below the water and water at its level.
 *  Objects render with their real footprint (rotation/span-aware), colored by category. */
export function paintLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  state: GridState,
  level: number,
  /** Pre-computed map aspect (w/h). If omitted, derived from template. */
  mapAspect?: number,
): void {
  const cols = state.template?.width ?? 0;
  const rows = state.template?.height ?? 0;
  if (!cols || !rows) return;

  const aspect = mapAspect ?? cols / rows;
  const fit = fitAspect(rect, aspect > 0 ? aspect : cols / Math.max(1, rows));

  ctx.save();
  rrPath(ctx, fit, 6);
  ctx.clip();

  const cellW = fit.w / cols;
  const cellH = fit.h / rows;
  const pw = Math.ceil(cellW);
  const ph = Math.ceil(cellH);
  const ground = level === 0;

  for (let row = 0; row < rows; row++) {
    const cellRow = state.cells[row];
    if (!cellRow) continue;
    for (let col = 0; col < cols; col++) {
      const cell = cellRow[col];
      if (!cell) continue;

      const px = fit.x + col * cellW;
      const py = fit.y + row * cellH;

      // Base silhouette: full on the ground layer, faint as context on higher layers.
      ctx.globalAlpha = ground ? 1 : 0.3;
      ctx.fillStyle = ZONES[cell.zone].color;
      ctx.fillRect(px, py, pw, ph);
      ctx.globalAlpha = 1;

      const terrain = cell.terrain;
      if (!terrain) continue;

      if (ground) {
        // Ground layer also shows ground-level water (rivers/lakes at elevation 0).
        if (terrain.type === TerrainType.Water && terrain.elevation === 0) {
          ctx.fillStyle = WATER_COLOR;
          ctx.fillRect(px, py, pw, ph);
        }
      } else if (terrain.type === TerrainType.Mountain) {
        // Cumulative: a mountain column reaching elevation >= level shows its slice at this level.
        if (terrain.elevation >= level) {
          ctx.fillStyle = ELEVATION_COLORS[level] ?? ELEVATION_COLORS[1]!;
          ctx.fillRect(px, py, pw, ph);
        }
      } else if (terrain.type === TerrainType.Water) {
        // Elevated water is 1-deep on a solid floor (levels below it are solid, the top is water).
        if (terrain.elevation === level) {
          ctx.fillStyle = WATER_COLOR;
          ctx.fillRect(px, py, pw, ph);
        } else if (terrain.elevation > level) {
          ctx.fillStyle = ELEVATION_COLORS[level] ?? ELEVATION_COLORS[1]!;
          ctx.fillRect(px, py, pw, ph);
        }
      }
    }
  }

  // Objects belonging to this layer (by their elevation), with real footprint.
  if (state.objects) {
    for (const obj of state.objects.values()) {
      if ((obj.elevation ?? 0) !== level) continue;
      const ox = Math.round(obj.position.x);
      const oy = Math.round(obj.position.y);
      if (ox < 0 || ox >= cols || oy < 0 || oy >= rows) continue;
      const { w: fw, h: fh } = getPlacedObjectSize(obj);
      ctx.fillStyle = objectMarkColor(obj.catalogId);
      ctx.fillRect(
        // The exact position, not `ox` (a half-anchored deck's rounded cell): a halfStep
        // ramp/bridge anchors between cells, so rounding draws it a half cell off from where
        // the 2D view places it.
        fit.x + obj.position.x * cellW,
        fit.y + obj.position.y * cellH,
        Math.ceil(Math.min(fw, cols - ox) * cellW),
        Math.ceil(Math.min(fh, rows - oy) * cellH),
      );
    }
  }

  ctx.restore();
}
