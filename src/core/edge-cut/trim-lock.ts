import { TerrainType, type GridState } from '../model/types';
import { getCell, NEIGHBORS4 } from '../model/grid-model';
import { EDGE_NEIGHBORS, CORNER_NEIGHBORS, terrainSolidAt, solidTopOf, structuralTop } from './terrain-silhouette';
import type { RoadLookup } from '../model/road-lookup';
import { waterfallFacesAt, type Direction } from '../model/waterfall-geometry';

type LockedCorners = [boolean, boolean, boolean, boolean];

/** Flow direction → the corners on that side of a cell (order [TL, TR, BL, BR]). */
const SIDE_CORNERS: Record<Direction, [number, number]> = {
  north: [0, 1],
  south: [2, 3],
  west: [0, 2],
  east: [1, 3],
};

export function computeLockedCorners(
  state: GridState, roads: RoadLookup, x: number, y: number, target: 'terrain' | 'road',
): LockedCorners {
  const locked: LockedCorners = [false, false, false, false];

  if (target === 'terrain') {
    const cell = getCell(state.cells, x, y);
    if (!cell?.terrain) return locked;
    const type = cell.terrain.type;
    // An outer cut lives on the cell's REAL base, so judge the seam at the base tier — for a gamma patch
    // that's `patchBase` (structuralTop), not the higher fillet tier.
    const elevation = structuralTop(cell.terrain);

    // WATERFALL-CELL — a water cell carrying a waterfall face IS the fall, and locks whole. The
    // drop side is already locked below, but the corners away from the flow — against the back
    // wall and the flanking caps, which pin nothing (not same-type) and drop nothing — read as
    // free, and cutting one rounds the falling water itself. (A rimmed pool has no face and still
    // rounds by the ordinary geometry.)
    if (type === TerrainType.Water && !cell.terrain.patchOnly && waterfallFacesAt(state, x, y).length > 0) {
      return [true, true, true, true];
    }

    // GEOMETRY (one generic rule): a corner is a FREE (convex) corner — cuttable — only if it is a real
    // convex corner of the SILHOUETTE AT THIS CELL'S LAYER. An EDGE neighbour covers (pins) the corner when
    // it holds solid SAME-TYPE mass AT this layer — i.e. a SAME-height OR a TALLER same-type neighbour, whose
    // stack passes through this layer and makes that edge interior. (A LOWER same-type step does NOT reach
    // this layer, so the bevel DOWN toward it is free; this is the only asymmetry — the high side rounds down
    // toward the low, the low side's corner toward the cliff is NOT a corner at its layer and stays square.)
    // A DIAGONAL neighbour touches at a single point and never pins.
    // POLICY (the genuine overrides, on top of the geometry — edge-judged):
    //   WATERFALL-LIP — elevated water never cuts toward a drop (open ground/void OR lower terrain):
    //      the falling lip stays square. (A same-level rim is not a drop, so a rimmed pool still rounds.)
    //   BANK — a MOUNTAIN that meets water on EXACTLY ONE edge of a corner is the water's BANK there:
    //      cutting that corner would peel the mountain off the water, leaving the pond/river unbanked on the
    //      rendered map. So it is not a free corner. (A corner with water on BOTH edges is an island/
    //      peninsula tip sitting IN the water — that still rounds out and reveals the water it sits in.)
    //   WATERFALL-FRAME — the cap mountains flanking a waterfall face keep their FLOW-side corners
    //      square (handled below via waterfallFacesAt).
    for (let i = 0; i < 4; i++) {
      let waterEdges = 0;
      for (const [dx, dy] of EDGE_NEIGHBORS[i]!) {
        const n = getCell(state.cells, x + dx, y + dy)?.terrain;
        if (n?.type === TerrainType.Water) waterEdges++;
        const isDrop = type === TerrainType.Water && elevation >= 1
          && Math.max(solidTopOf(n, TerrainType.Water), solidTopOf(n, TerrainType.Mountain)) < elevation;
        // same-type mass solid AT this layer (same-height or taller) covers the corner → not convex here.
        if (terrainSolidAt(n, type, elevation) || isDrop) locked[i] = true;
      }
      // BANK: a mountain that meets water at a corner holds the water's bank → that corner is locked, UNLESS
      // it is a true island/peninsula TIP: water on BOTH edges AND the mountain does NOT continue on the
      // diagonal. If the same-type mass continues diagonally (a block reaching this layer), the two water
      // edges are a DIAGONAL water PINCH around continuous terrain — a bank, not a tip → locked, mirroring the
      // mountain Γ pinch (whose lower/continuing diagonal also doesn't enclose). A ground or water diagonal =
      // a genuine rock/peninsula → free. This keeps the cut type-agnostic: m+m / m+w / w+w behave identically
      // at a pinch, on the ground or on a base.
      if (type === TerrainType.Mountain && waterEdges >= 1) {
        const d = CORNER_NEIGHBORS[i]![2]!;
        const diag = getCell(state.cells, x + d[0], y + d[1])?.terrain;
        if (waterEdges === 1 || terrainSolidAt(diag, type, elevation)) locked[i] = true;
      }
    }
    if (type === TerrainType.Mountain) {
      // WATERFALL-FRAME: any cardinal water neighbour at this cap's exact elevation with a capped
      // waterfall face locks this mountain's corners on the face's flow side.
      for (const [dx, dy] of NEIGHBORS4) {
        const n = getCell(state.cells, x + dx, y + dy)?.terrain;
        if (!n || n.type !== TerrainType.Water || n.patchOnly || n.elevation !== elevation) continue;
        for (const face of waterfallFacesAt(state, x + dx, y + dy)) {
          const [a, b] = SIDE_CORNERS[face.flowDirection];
          locked[a] = true;
          locked[b] = true;
        }
      }
    }
  } else {
    const top = roads(x, y - 1) !== null;
    const bottom = roads(x, y + 1) !== null;
    const left = roads(x - 1, y) !== null;
    const right = roads(x + 1, y) !== null;
    const count = [top, bottom, left, right].filter(Boolean).length;

    if (count === 0) return locked;
    if (count >= 3 || (count === 2 && ((top && bottom) || (left && right)))) {
      return [true, true, true, true];
    }
    if (count === 1) {
      if (top) { locked[0] = true; locked[1] = true; }
      if (bottom) { locked[2] = true; locked[3] = true; }
      if (left) { locked[0] = true; locked[2] = true; }
      if (right) { locked[1] = true; locked[3] = true; }
    } else {
      locked[0] = locked[1] = locked[2] = locked[3] = true;
      if (!top && !left) locked[0] = false;
      if (!top && !right) locked[1] = false;
      if (!bottom && !left) locked[2] = false;
      if (!bottom && !right) locked[3] = false;
    }
  }
  return locked;
}
