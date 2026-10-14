import { TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { componentCells, labelComponents, stepDistance } from '../../core/grid/cell-sets';
import { isBuildableZone } from '../../core/game/zones';
import { buildObjectOccupancy } from '../../state/object-geometry';
import { cellKey } from '../../core/grid/rect';
import { surfaceElevation } from '../../core/domain/terrain/terrain-surface';


export interface PlacementAnalysis {
  width: number; height: number;
  grass: Uint8Array;          // 1 = grass cell
  /** 1 = buildable: grass, not water, in the interior of a uniform-elevation area (so the flat
   *  trait's +1 footprint margin never straddles a cliff/shore), and not occupied. Spans all tiers —
   *  flat mountain plateaus qualify, not just tier-0 ground. Used for placement + road surface. */
  open: Uint8Array;
  elev: Int8Array;            // buildable elevation per cell (mountain tier, 0 for ground); 0 for non-buildable
  region: Int32Array;         // open-region id per cell, -1 otherwise (one region per contiguous same-elevation area; `road-paving.ts:claimHubRegion` may add a hub footprint as one)
  rankedRegions: number[];    // region ids, largest first
  regionCells: number[][];    // cells (flat index) per region id
  regionElev: number[];       // elevation of each region id (so settlement/network know a region's tier)
  distToWater: Int16Array;    // BFS cells to nearest water (far if none)
}

const NON_BUILDABLE = -999; // sentinel "level" for water / non-grass cells (never equals a real tier)

export function analyzeTerrain(state: GridState, restrictTo?: MacroCoord[] | null): PlacementAnalysis {
  const { width, height } = state.template;
  const grass = new Uint8Array(width * height), open = new Uint8Array(width * height);
  const elev = new Int8Array(width * height);
  const waterSeeds: number[] = [];
  // When generating inside a selected region, the placeable mask is confined to it so the settlement,
  // network, and ecology all stay within the region (matching the terrain pass) — not just the terrain.
  const inRegion = restrictTo && restrictTo.length ? new Set(restrictTo.map((c) => c.y * width + c.x)) : null;
  const occ = buildObjectOccupancy(state);

  // A cell's buildable level: its real surface, as the flat rule reads it, or NON_BUILDABLE for water or non-grass.
  const levelAt = (x: number, y: number): number => {
    const c = getCell(state.cells, x, y);
    if (!c || !isBuildableZone(c.zone)) return NON_BUILDABLE;
    if (c.terrain?.type === TerrainType.Water) return NON_BUILDABLE;
    return surfaceElevation(c.terrain);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, cell = getCell(state.cells, x, y);
      const isGrass = !!cell && isBuildableZone(cell.zone);
      grass[i] = isGrass ? 1 : 0;
      if (cell?.terrain?.type === TerrainType.Water) waterSeeds.push(i);
      const lv = levelAt(x, y);
      elev[i] = lv === NON_BUILDABLE ? 0 : lv;
      // Buildable + unoccupied + level-interior: every in-bounds 8-neighbour is the same level, so the
      // flat trait's footprint margin is uniform. Off-map neighbours are ignored (the flat rule skips
      // null cells too), so the map border / shoreline edge of grass stays buildable.
      let levelInterior = lv !== NON_BUILDABLE && !occ.has(cellKey(x, y));
      if (levelInterior) {
        for (let dy = -1; dy <= 1 && levelInterior; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; // off-map → ignore
            if (levelAt(nx, ny) !== lv) { levelInterior = false; break; }
          }
        }
      }
      open[i] = levelInterior && (!inRegion || inRegion.has(i)) ? 1 : 0;
    }
  }

  // Regions = contiguous open cells of the same elevation (4-connected). The edge-erosion above means
  // open cells of different tiers are never adjacent, so this yields one region per plateau / ground area.
  const { labels, sizes } = labelComponents(open, width, height, false, (i, j) => elev[i] === elev[j]);
  const region = labels.map((label) => label - 1);
  const regionCells = componentCells(labels, sizes.length - 1);
  const regionElev = regionCells.map((cells) => elev[cells[0]!]!);
  const rankedRegions = regionCells.map((_, id) => id).sort((a, b) => regionCells[b]!.length - regionCells[a]!.length);
  return { width, height, grass, open, elev, region, rankedRegions, regionCells, regionElev, distToWater: stepDistance(waterSeeds, width, height) };
}
