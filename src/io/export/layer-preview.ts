import { TerrainType } from '../../core/model/types';
import { ELEVATION_COLORS, ELEVATION_MAX, WATER_COLOR, ZONE_COLORS } from '../../core/model/constants';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { fitAspect } from './compose';
import { rrPath } from './canvas-helpers';
import type { GridState } from '../../core/model/types';

/** One step of the construction sequence: the map built up TO `level`. */
export interface LayerStep {
  level: number;
  labelKey: string;
}

/** The per-layer construction sequence: ground (0) up to the map's max terrain elevation
 *  (capped at ELEVATION_MAX). Each step is one thumbnail showing the map built up TO that
 *  level. Always returns at least `[{ level: 0, ... }]` (a bare-ground map). */
export function layersFor(state: GridState): LayerStep[] {
  const maxElev = maxTerrainElevation(state);
  const steps: LayerStep[] = [];
  for (let level = 0; level <= maxElev; level++) {
    steps.push({ level, labelKey: level === 0 ? 'export.layer_ground' : 'export.layer_level' });
  }
  return steps;
}

export function maxTerrainElevation(state: GridState): number {
  let maxElev = 0;
  for (const row of state.cells) {
    if (!row) continue;
    for (const cell of row) {
      const t = cell?.terrain;
      if (!t) continue;
      if (t.type === TerrainType.Mountain || t.type === TerrainType.Water) {
        if (t.elevation > maxElev) maxElev = t.elevation;
      }
    }
  }
  return Math.min(maxElev, ELEVATION_MAX);
}

/** Category-ish color for object marks in the thumbnail. */
function objectColor(catalogId: string): string {
  const item = getCatalogItem(catalogId);
  if (!item) return '#e6c48a';
  const cat = item.category;
  if (cat === 'building') return '#e8a857';
  if (cat === 'tree') return '#5cb837';
  if (cat === 'flora') return '#7dba53';
  if (cat === 'road') return '#d4c9b0';
  if (cat === 'bridge') return '#c4a06a';
  if (cat === 'ramp') return '#b88c50';
  if (cat === 'facility') return '#74b0d4';
  return '#e6c48a';
}

/** Draw ONE layer's CROSS-SECTION at height `level` into `rect` (cumulative, like the 2D layer
 *  panel: a cell at elevation 3 occupies layers 1, 2 AND 3). Browser-only (Canvas-2D).
 *  - The island silhouette (zones) is the base: FULL on the ground layer (it IS the land),
 *    FAINT on higher layers (context behind that layer's tiles).
 *  - Level 0 (Ground): the land plus ground-level water (elevation 0) and ground objects.
 *  - Level N >= 1: every cell whose column reaches height N — a mountain with elevation >= N shows
 *    its slice (so a tall block still renders at the lower layers it passes through, not only at its
 *    top); elevated water shows its solid floor (mountain) below the water and water AT its level.
 *  Objects render with their real FOOTPRINT (rotation/span-aware), colored by category. */
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
  rrPath(ctx, fit.x, fit.y, fit.w, fit.h, 6);
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

      // Base island: full on the ground layer, faint as context on higher layers.
      ctx.globalAlpha = ground ? 1 : 0.3;
      ctx.fillStyle = ZONE_COLORS[cell.zone] ?? ZONE_COLORS[2]!;
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
        // Cumulative: a mountain column reaching elevation >= level shows its slice at THIS level.
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

  // Objects belonging to THIS layer (by their elevation), with real footprint.
  if (state.objects) {
    for (const obj of state.objects.values()) {
      if ((obj.elevation ?? 0) !== level) continue;
      const ox = Math.round(obj.position.x);
      const oy = Math.round(obj.position.y);
      if (ox < 0 || ox >= cols || oy < 0 || oy >= rows) continue;
      const { w: fw, h: fh } = getPlacedObjectSize(obj);
      ctx.fillStyle = objectColor(obj.catalogId);
      ctx.fillRect(
        fit.x + ox * cellW,
        fit.y + oy * cellH,
        Math.ceil(Math.min(fw, cols - ox) * cellW),
        Math.ceil(Math.min(fh, rows - oy) * cellH),
      );
    }
  }

  ctx.restore();
}
