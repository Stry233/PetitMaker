import { CommandType, TerrainType } from '../model/types';
import type { Command, Corners, GridState, MacroCoord, PlacedObject, TrimCornersCommand } from '../model/types';
import { getCell, cellKey } from '../model/grid-model';
import { computeLockedCorners } from './trim-lock';
import { cornerWrappedAt, groundConvexCornerInWater } from './terrain-silhouette';
import { validateCut, isInnerCorner } from './cut-validator';
import type { RoadLookup } from '../model/road-lookup';
import {
  CANONICAL_ROAD_STATES, ROTATION_TO_CONN,
  canonicalToActual, classifyRoadKind, countRoadNeighbors, detectRoadConn,
} from './road-cut-states';

/** Minimal sink for repair commands plus the paved-cell lookup the road repairs
 *  need — satisfied by CommandExecutor. */
export interface CutReconcileTarget {
  execute(cmd: Command): unknown;
  roadAt: RoadLookup;
}

const MAX_RECONCILE_PASSES = 16;

/** Changed cells plus their 8-neighbourhood, deduplicated. */
function expandRegion(cells: MacroCoord[]): MacroCoord[] {
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
  if (!corners || corners.every(c => c === 'square')) return false;

  const locked = computeLockedCorners(state, target.roadAt, x, y, 'terrain');
  const next = [...corners] as Corners;
  let changed = false;
  for (let i = 0; i < 4; i++) {
    if (locked[i] && next[i] !== 'square') { next[i] = 'square'; changed = true; }
  }
  if (!changed) return false;

  target.execute({
    type: CommandType.TrimCorners,
    timestamp: Date.now(),
    x, y, layer: 'terrain',
    beforeCorners: corners, afterCorners: next,
  } as TrimCornersCommand);
  return true;
}

/** Revert any corner of a GROUND islet-cut cell (type None + corners) that no longer pokes into water —
 *  e.g. the surrounding water was filled or moved. Squaring the last cut corner drops the cell back to plain
 *  ground (handled by the TrimCorners apply). Returns true if it changed. */
function reconcileGroundIsland(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (cell?.terrain?.type !== TerrainType.None) return false;
  const corners = cell.terrain.corners;
  if (!corners) return false;
  const next = [...corners] as Corners;
  let changed = false;
  for (let i = 0; i < 4; i++) {
    if (next[i] !== 'square' && !groundConvexCornerInWater(state, x, y, i)) { next[i] = 'square'; changed = true; }
  }
  if (!changed) return false;
  target.execute({
    type: CommandType.TrimCorners, timestamp: Date.now(),
    x, y, layer: 'terrain', beforeCorners: corners, afterCorners: next,
  } as TrimCornersCommand);
  return true;
}

const SQUARE_CORNERS: Corners = ['square', 'square', 'square', 'square'];

interface RoadReplacement {
  corners: Corners;
  rotation?: 0 | 90 | 180 | 270;
}

/** Find a same-kind canonical state whose actual form is valid in the current context. */
function findSameKindRoadState(
  state: GridState, roads: RoadLookup, road: PlacedObject, conn: string, kind: 'round' | 'direct',
): RoadReplacement | null {
  const isolated = countRoadNeighbors(roads, road) === 0;
  const { x, y } = road.position;
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    const canonical = CANONICAL_ROAD_STATES[i]!;
    if (!canonical || classifyRoadKind(canonical) !== kind) continue;
    if (isolated) {
      for (const rot of [0, 90, 180, 270] as const) {
        const actual = canonicalToActual(canonical, ROTATION_TO_CONN[rot]!);
        if (validateCut(state, roads, x, y, 'road', actual)) return { corners: [...canonical], rotation: rot };
      }
    } else {
      const actual = canonicalToActual(canonical, conn);
      if (validateCut(state, roads, x, y, 'road', actual)) return { corners: [...canonical] };
    }
  }
  return null;
}

/** Reconcile a cut road at (x,y): keep same kind if possible (rotated to fit), else raw. */
function reconcileRoadAt(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const roads = target.roadAt;
  const road = roads(x, y);
  if (!road?.corners || road.corners.every(c => c === 'square')) return false;

  const conn = detectRoadConn(roads, road);
  const actual = canonicalToActual(road.corners, conn);
  if (validateCut(state, roads, x, y, 'road', actual)) return false; // still valid

  const kind = classifyRoadKind(road.corners);
  const replacement = kind ? findSameKindRoadState(state, roads, road, conn, kind) : null;
  if (replacement) {
    // Carry the rotation change on the command (rather than mutating road.rotation
    // directly) so undo/redo can restore it; applyCommand applies afterRotation.
    target.execute({
      type: CommandType.TrimCorners,
      timestamp: Date.now(),
      x, y, layer: 'road', objectId: road.id,
      beforeCorners: [...road.corners] as Corners, afterCorners: replacement.corners,
      ...(replacement.rotation !== undefined
        ? { beforeRotation: road.rotation, afterRotation: replacement.rotation }
        : {}),
    } as TrimCornersCommand);
  } else {
    target.execute({
      type: CommandType.TrimCorners,
      timestamp: Date.now(),
      x, y, layer: 'road', objectId: road.id,
      beforeCorners: [...road.corners] as Corners, afterCorners: [...SQUARE_CORNERS],
    } as TrimCornersCommand);
  }
  return true;
}

/** Remove a terrain Γ-patch whose concave inner-corner context no longer holds.
 *  POLICY CYCLE-OFF-KEEPS-BASE (reconcile half): removing a fillet must never destroy the base it sat
 *  on — a tier-N≥2 MOUNTAIN patch drops back to its tier-(N-1) square block. (Water clears to empty
 *  instead: reconcile runs AFTER post-stroke validation, and repainting water here could
 *  leave an unvalidated illegal water body.) */
function reconcilePatchTerrain(state: GridState, target: CutReconcileTarget, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell?.terrain?.patchOnly) return false;
  const terrain = cell.terrain;
  const corners = terrain.corners;
  if (!corners) return false;
  // A gamma fillet lives on a WRAPPED (concave) corner. Full-base 'square' corners and UNWRAPPED outer
  // cuts (a bevel sharing the cell) are NOT fillets — they must not be mistaken for one. A fillet is
  // CURRENT while its concave context holds AND it still rounds the wrapping mass's rim: a wall
  // stacked past the fillet's tier (the corner wrapped one tier ABOVE it) has OUTGROWN it, and the
  // fillet can never follow — it already sits at the one tier its support allows — so it would stand
  // as a stray wedge at the foot of the taller notch. The patch survives while some fillet is
  // current; a raise invalidates a fillet exactly as it clears an OUTER cut.
  const filletCurrent = (c: string, i: number): boolean =>
    c !== 'empty' && c !== 'square'
    && isInnerCorner(state, x, y, i, terrain.type, terrain.elevation)
    && !cornerWrappedAt(state, x, y, i, terrain.type, terrain.elevation + 1);
  if (corners.some(filletCurrent)) {
    // Clear any OUTGROWN corner beside the surviving fillet(s). A corner no longer wrapped at all
    // stays, since it renders as an outer bevel on the base.
    const stale = corners.map((c, i) =>
      c !== 'empty' && c !== 'square' && !filletCurrent(c, i)
      && cornerWrappedAt(state, x, y, i, terrain.type, terrain.elevation + 1));
    if (!stale.some(Boolean)) return false;
    const kept = corners.map((c, i) => (stale[i] ? 'empty' : c)) as Corners;
    target.execute({
      type: CommandType.TrimCorners, timestamp: Date.now(),
      x, y, layer: 'terrain', beforeCorners: corners, afterCorners: kept,
    } as TrimCornersCommand);
    return true;
  }

  // No fillet's context holds → drop the gamma. CYCLE-OFF-KEEPS-BASE: a real base (patchBase >= 1)
  // drops to its square block; a from-empty gamma (patchBase 0) clears to nothing.
  const baseElev = terrain.patchBase ?? (terrain.elevation - 1);
  if (terrain.type === TerrainType.Mountain && baseElev >= 1) {
    const res = target.execute({
      type: CommandType.PaintTerrain, timestamp: Date.now(),
      cells: [{ x, y }], terrainType: cell.terrain.type, elevation: baseElev,
    } as Command) as { success?: boolean } | undefined;
    if (res && res.success !== false) {
      // PER-CORNER: dropping the fillet must keep an UNWRAPPED outer bevel sharing the cell — only the
      // fillet corners reset to default. (In this branch no fan/tri corner is wrapped, so any survives as an
      // outer cut; the former-fillet corners are 'empty' and become full base.)
      const kept = corners.map(c => (c === 'empty' ? 'square' : c)) as Corners;
      if (kept.some(c => c !== 'square')) {
        target.execute({
          type: CommandType.TrimCorners, timestamp: Date.now(),
          x, y, layer: 'terrain', beforeCorners: SQUARE_CORNERS, afterCorners: kept,
        } as TrimCornersCommand);
      }
      return true; // fall through to empty only if the paint was rejected
    }
  }
  target.execute({
    type: CommandType.TrimCorners,
    timestamp: Date.now(),
    x, y, layer: 'terrain',
    beforeCorners: corners, afterCorners: ['empty', 'empty', 'empty', 'empty'],
  } as TrimCornersCommand);
  return true;
}

/**
 * Reconcile edge cuts on the changed cells and their neighbours to the closest valid
 * form. Repeats until stable (every change moves an element toward square, which is
 * always legal, so it converges within MAX_RECONCILE_PASSES).
 */
export function reconcileCuts(changedCells: MacroCoord[], state: GridState, target: CutReconcileTarget): void {
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
