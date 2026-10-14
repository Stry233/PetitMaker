import { paintTerrainCommand, trimRoadCommand, trimTerrainCommand } from '../../model/command-build';
import { TerrainType, type Rotation, ROTATIONS } from '../../model/types';
import type { Command, Corners, GridState, MacroCoord, PlacedObject } from '../../model/types';
import { getCell } from '../../model/grid-model';
import { cellKey } from '../../grid/rect';
import { computeLockedCorners } from './trim-lock';
import { cornerWrappedAt, groundConvexCornerInWater } from './silhouette';
import { patchSupport } from '../terrain/terrain-surface';
import { validateCut, isInnerCorner } from './cut-validator';
import type { RoadLookup } from '../../model/road-lookup';
import type { StrokeKernel } from '../../model/stroke-policy';
import {
  CANONICAL_ROAD_STATES, ROTATION_TO_CONN,
  canonicalToActual, classifyRoadKind, countRoadNeighbors, detectRoadConn, type RoadConnSide,
} from './road-cut-states';
import { SQUARE_CORNERS, EMPTY_CORNERS, isSquareCorners, copyCorners, mapCorners } from '../../model/corners';

/** The executor the repairs go through, and the paved-cell lookup the road repairs need. */
interface CutReconcileTarget {
  kernel: StrokeKernel;
  roadAt: RoadLookup;
}

/** Run one repair; true when it landed. A refused repair (a locked layer) is an outcome, so it is
 *  probed first and never reaches the executor's refusal report. */
function repair(target: CutReconcileTarget, cmd: Command): boolean {
  return target.kernel.validatePre(cmd).length === 0 && target.kernel.execute(cmd).success;
}

const MAX_RECONCILE_PASSES = 16;

/** Changed cells plus their 8-neighbourhood, deduplicated. */
function expandRegion(cells: readonly MacroCoord[]): MacroCoord[] {
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const { x, y } of cells) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        const key = cellKey(nx, ny);
        if (!seen.has(key)) { seen.add(key); out.push({ x: nx, y: ny }); }
      }
    }
  }
  return out;
}

/** Revert any locked-but-cut corner of a real terrain cell to square. Returns true if it changed. */
function reconcileTerrainCell(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell?.terrain || cell.terrain.type === TerrainType.None || cell.terrain.patchOnly) return false;
  const corners = cell.terrain.corners;
  if (!corners || isSquareCorners(corners)) return false;

  const locked = computeLockedCorners(state, target.roadAt, x, y, 'terrain');
  const next = copyCorners(corners);
  let changed = false;
  for (let i = 0; i < 4; i++) {
    if (locked[i] && next[i] !== 'square') { next[i] = 'square'; changed = true; }
  }
  if (!changed) return false;
  return repair(target, trimTerrainCommand(x, y, next));
}

/** Revert any corner of a ground islet-cut cell (type None + corners) that no longer pokes into water —
 *  e.g. the surrounding water was filled or moved. Squaring the last cut corner drops the cell back to plain
 *  ground (handled by the TrimCorners apply). Returns true if it changed. */
function reconcileGroundIsland(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (cell?.terrain?.type !== TerrainType.None) return false;
  const corners = cell.terrain.corners;
  if (!corners) return false;
  const next = copyCorners(corners);
  let changed = false;
  for (let i = 0; i < 4; i++) {
    if (next[i] !== 'square' && !groundConvexCornerInWater(state, x, y, i)) { next[i] = 'square'; changed = true; }
  }
  if (!changed) return false;
  return repair(target, trimTerrainCommand(x, y, next));
}

interface RoadReplacement {
  corners: Corners;
  rotation?: Rotation;
}

/** Find a same-kind canonical state whose actual form is valid in the current context. */
function findSameKindRoadState(
  state: GridState, roads: RoadLookup, road: PlacedObject, conn: RoadConnSide, kind: 'round' | 'direct',
): RoadReplacement | null {
  const isolated = countRoadNeighbors(roads, road) === 0;
  const { x, y } = road.position;
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    const canonical = CANONICAL_ROAD_STATES[i]!;
    if (!canonical || classifyRoadKind(canonical) !== kind) continue;
    if (isolated) {
      for (const rot of ROTATIONS) {
        const actual = canonicalToActual(canonical, ROTATION_TO_CONN[rot]);
        if (validateCut(state, roads, { x, y }, 'road', actual)) return { corners: [...canonical], rotation: rot };
      }
    } else {
      const actual = canonicalToActual(canonical, conn);
      if (validateCut(state, roads, { x, y }, 'road', actual)) return { corners: [...canonical] };
    }
  }
  return null;
}

/** Reconcile a cut road at (x,y): keep same kind if possible (rotated to fit), else raw. */
function reconcileRoadAt(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const roads = target.roadAt;
  const road = roads(x, y);
  if (!road?.corners || isSquareCorners(road.corners)) return false;

  const conn = detectRoadConn(roads, road);
  const actual = canonicalToActual(road.corners, conn);
  if (validateCut(state, roads, { x, y }, 'road', actual)) return false; // still valid

  const kind = classifyRoadKind(road.corners);
  const replacement = kind ? findSameKindRoadState(state, roads, road, conn, kind) : null;
  // The rotation change rides on the command, so the history entry records the road turned.
  return repair(target, replacement
    ? trimRoadCommand(road, x, y, replacement.corners, replacement.rotation)
    : trimRoadCommand(road, x, y, [...SQUARE_CORNERS]));
}

/** Remove a terrain Γ-patch whose concave inner-corner context no longer holds.
 *  Policy cycle-off-keeps-base (reconcile half): removing a fillet must never destroy the base it sat
 *  on — a tier-N≥2 mountain patch drops back to its tier-(N-1) square block. (Water clears to empty
 *  instead: reconcile runs after post-stroke validation, and repainting water here could
 *  leave an unvalidated illegal water body.) */
function reconcilePatchTerrain(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell?.terrain?.patchOnly) return false;
  const terrain = cell.terrain;
  const corners = terrain.corners;
  if (!corners) return false;
  // A gamma fillet lives on a wrapped (concave) corner. Full-base 'square' corners and unwrapped outer
  // cuts (a bevel sharing the cell) are not fillets — they must not be mistaken for one. A fillet is
  // Current while its concave context holds and it still rounds the wrapping mass's rim: a wall
  // stacked past the fillet's tier (the corner wrapped one tier above it) has outgrown it, and the
  // fillet can never follow — it already sits at the one tier its support allows — so it would stand
  // as a stray wedge at the foot of the taller notch. The patch survives while some fillet is
  // current; a raise invalidates a fillet exactly as it clears an outer cut.
  const filletCurrent = (c: string, i: number): boolean =>
    c !== 'empty' && c !== 'square'
    && isInnerCorner(state, x, y, i, terrain)
    && !cornerWrappedAt(state, x, y, i, { type: terrain.type, elevation: terrain.elevation + 1 });
  if (corners.some(filletCurrent)) {
    // Clear any outgrown corner beside the surviving fillet(s). A corner no longer wrapped at all
    // stays, since it renders as an outer bevel on the base.
    const stale = corners.map((c, i) =>
      c !== 'empty' && c !== 'square' && !filletCurrent(c, i)
      && cornerWrappedAt(state, x, y, i, { type: terrain.type, elevation: terrain.elevation + 1 }));
    if (!stale.some(Boolean)) return false;
    const kept = mapCorners(corners, (c, i) => (stale[i] ? 'empty' : c));
    return repair(target, trimTerrainCommand(x, y, kept));
  }

  // No fillet's context holds → drop the gamma. Cycle-off-keeps-base: a real base (patchBase >= 1)
  // drops to its square block; a from-empty gamma (patchBase 0) clears to nothing.
  const baseElev = patchSupport(terrain);
  if (terrain.type === TerrainType.Mountain && baseElev >= 1) {
    if (repair(target, paintTerrainCommand([{ x, y }], cell.terrain.type, baseElev))) {
      // Per-corner: dropping the fillet must keep an unwrapped outer bevel sharing the cell — only the
      // fillet corners reset to default. (In this branch no fan/tri corner is wrapped, so any survives as an
      // outer cut; the former-fillet corners are 'empty' and become full base.)
      const kept = mapCorners(corners, c => (c === 'empty' ? 'square' : c));
      if (kept.some(c => c !== 'square')) repair(target, trimTerrainCommand(x, y, kept));
      return true;
    }
  }
  return repair(target, trimTerrainCommand(x, y, [...EMPTY_CORNERS]));
}

/**
 * Reconcile edge cuts on the changed cells and their neighbours to the closest valid
 * form. Repeats until stable: every change moves an element toward square, and a refused
 * repair (a locked layer) counts as no change, so it converges within MAX_RECONCILE_PASSES.
 */
export function reconcileCuts(changedCells: readonly MacroCoord[], kernel: StrokeKernel, roadAt: RoadLookup): void {
  const state = kernel.state;
  const target: CutReconcileTarget = { kernel, roadAt };
  // The working region grows as repairs propagate: a repair at a cell can invalidate a
  // neighbour just outside the initial 8-neighbourhood (a road change can cascade hop by
  // hop), so when a cell is repaired we fold its neighbourhood into the region for a later
  // pass. Each pass re-scans the current region; new cells are picked up next pass.
  // Key → coord map: the key dedupes, the stored coord spares every pass a
  // string-parse round trip back to numbers.
  const region = new Map<string, MacroCoord>();
  for (const c of expandRegion(changedCells)) region.set(cellKey(c.x, c.y), c);

  let changed = true;
  let passes = 0;
  while (changed && passes < MAX_RECONCILE_PASSES) {
    changed = false;
    passes++;
    for (const { x, y } of [...region.values()]) {
      let repaired = false;
      if (reconcileTerrainCell(state, target, x, y)) repaired = true;
      if (reconcilePatchTerrain(state, target, x, y)) repaired = true;
      if (reconcileGroundIsland(state, target, x, y)) repaired = true;
      if (reconcileRoadAt(state, target, x, y)) repaired = true;
      if (repaired) {
        changed = true;
        for (const c of expandRegion([{ x, y }])) region.set(cellKey(c.x, c.y), c);
      }
    }
  }
}
