import { TerrainType, type GridState } from '../../model/types';
import { getCell } from '../../model/grid-model';
import { DIRECTION_SIDE, NEIGHBORS4, SIDES, SIDE_DELTA, type Side } from '../../grid/directions';
import { CORNERS, cornersOnSide } from '../../model/corners';
import { terrainSolidAt, solidTopOf, structuralTop } from '../terrain/terrain-surface';
import type { RoadLookup } from '../../model/road-lookup';
import { waterfallFacesAt } from '../terrain/waterfall-geometry';

type LockedCorners = [boolean, boolean, boolean, boolean];

export function computeLockedCorners(
  state: GridState, roads: RoadLookup, x: number, y: number, target: 'terrain' | 'road',
): LockedCorners {
  const locked: LockedCorners = [false, false, false, false];

  if (target === 'terrain') {
    const cell = getCell(state.cells, x, y);
    if (!cell?.terrain) return locked;
    const type = cell.terrain.type;
    // An outer cut lives on the cell's real base, so judge the seam at the base tier — for a gamma patch
    // that's `patchBase` (structuralTop), not the higher fillet tier.
    const elevation = structuralTop(cell.terrain);

    // Waterfall-cell — a water cell carrying a waterfall face is the fall, and locks whole. The
    // drop side is already locked below, but the corners away from the flow — against the back
    // wall and the flanking caps, which pin nothing (not same-type) and drop nothing — read as
    // free, and cutting one rounds the falling water itself. (A rimmed pool has no face and still
    // rounds by the ordinary geometry.)
    if (type === TerrainType.Water && !cell.terrain.patchOnly && waterfallFacesAt(state, x, y).length > 0) {
      return [true, true, true, true];
    }

    // Geometry: a corner is free (cuttable) only if it is a convex corner of the silhouette at this
    // cell's layer. An edge neighbour pins it when it holds same-type mass at this layer (same height
    // or taller); a lower same-type step does not, so the high side rounds down toward the low.
    // Diagonal neighbours never pin.
    // Policy, edge-judged:
    //   waterfall lip: elevated water never cuts toward a drop (void or lower terrain).
    //   bank: a mountain meeting water on exactly one edge of a corner keeps it, or the water would
    //      be left unbanked; with water on both edges it is a tip in the water and still rounds.
    //   waterfall frame: cap mountains flanking a waterfall face keep their flow-side corners
    //      square (via waterfallFacesAt below).
    for (let i = 0; i < 4; i++) {
      let waterEdges = 0;
      for (const [dx, dy] of CORNERS[i]!.edges) {
        const n = getCell(state.cells, x + dx, y + dy)?.terrain;
        if (n?.type === TerrainType.Water) waterEdges++;
        const isDrop = type === TerrainType.Water && elevation >= 1
          && Math.max(solidTopOf(n, TerrainType.Water), solidTopOf(n, TerrainType.Mountain)) < elevation;
        // same-type mass solid at this layer (same-height or taller) covers the corner → not convex here.
        if (terrainSolidAt(n, type, elevation) || isDrop) locked[i] = true;
      }
      // Bank: a mountain that meets water at a corner holds the water's bank → that corner is locked, unless
      // it is a true islet/peninsula tip: water on both edges and the mountain does not continue on the
      // diagonal. If the same-type mass continues diagonally (a block reaching this layer), the two water
      // edges are a diagonal water pinch around continuous terrain — a bank, not a tip → locked, mirroring the
      // mountain Γ pinch (whose lower/continuing diagonal also doesn't enclose). A ground or water diagonal =
      // a genuine rock/peninsula → free. This keeps the cut type-agnostic: m+m / m+w / w+w behave identically
      // at a pinch, on the ground or on a base.
      if (type === TerrainType.Mountain && waterEdges >= 1) {
        const d = CORNERS[i]!.diagonal;
        const diag = getCell(state.cells, x + d[0], y + d[1])?.terrain;
        if (waterEdges === 1 || terrainSolidAt(diag, type, elevation)) locked[i] = true;
      }
    }
    if (type === TerrainType.Mountain) {
      // Waterfall-frame: any cardinal water neighbour at this cap's exact elevation with a capped
      // waterfall face locks this mountain's corners on the face's flow side.
      for (const [dx, dy] of NEIGHBORS4) {
        const n = getCell(state.cells, x + dx, y + dy)?.terrain;
        if (!n || n.type !== TerrainType.Water || n.patchOnly || n.elevation !== elevation) continue;
        for (const face of waterfallFacesAt(state, x + dx, y + dy)) {
          const [a, b] = cornersOnSide(DIRECTION_SIDE[face.flowDirection]);
          locked[a] = true;
          locked[b] = true;
        }
      }
    }
  } else {
    const joined = new Set<Side>(SIDES.filter((side) => roads(x + SIDE_DELTA[side][0], y + SIDE_DELTA[side][1]) !== null));
    if (joined.size >= 3 || (joined.has('N') && joined.has('S')) || (joined.has('W') && joined.has('E'))) {
      return [true, true, true, true];
    }
    // One joined side, or two adjacent: a corner on a joined side keeps square.
    for (let i = 0; i < 4; i++) locked[i] = CORNERS[i]!.sides.some((side) => joined.has(side));
  }
  return locked;
}
