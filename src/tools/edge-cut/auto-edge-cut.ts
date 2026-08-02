/*
 * auto-edge-cut.ts — applies automatic corner-trimming to a finished brush
 * stroke when the Build panel's "Auto Trim" toggle is on. Runs at the
 * post-stroke stage, AFTER validation, on whatever cells survived.
 *
 * Two styles (mirroring the manual edge-cut tool + classifyRoadKind):
 *   - 'rect'  → straight 45° bevel  (triangle cut / 'direct' road states)
 *   - 'round' → curved chamfer      (fan cut       / 'round' road states)
 *
 * Terrain (mountain/water) covers BOTH corner kinds, like the manual tool:
 *   - convex OUTER corners of painted cells (the ones computeLockedCorners
 *     leaves unlocked) are trimmed in place;
 *   - concave INNER corners (Γ-patches) — empty cells tucked into a notch of
 *     the stroke — are filled with a patch carrying the trimmed corner.
 * Already-trimmed corners are kept so a repaint preserves manual edits.
 *
 * Tile (road): roads only render the canonical cut states (see trim-shapes /
 * road-cut-states), so we pick the first canonical state of the requested kind
 * that validateCut() accepts for the cell's connectivity. Interior road cells
 * force all-square, so only end-caps and bends actually get trimmed.
 */
import { CommandType, TerrainType } from '../../core/model/types';
import type { AutoEdgeCut, Command, Corners, GridState, MacroCoord, TrimCornersCommand, ValidationResult } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { groundConvexCornerInWater, highestNeighborTerrain, surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { validateCut, isInnerCorner, OUTER_TRI, INNER_TRI } from '../../core/edge-cut/cut-validator';
import {
  CANONICAL_ROAD_STATES, canonicalToActual, detectRoadConn, findRoadAt,
} from '../../core/edge-cut/road-cut-states';

/** The minimal slice of ToolContext the corner-cut helpers actually need — so the generator can drive
 *  them with just its grid + execute closure, without fabricating a full ToolContext. */
export interface EdgeCutCtx { gridState: GridState; executeCommand: (cmd: Command) => ValidationResult; }

// Canonical road states (indices into CANONICAL_ROAD_STATES) by kind, in
// preference order. 'round' prefers the wedge (both far corners), then the
// single fans; 'rect' uses the two diagonals.
const ROUND_STATES = [5, 1, 2];
const DIRECT_STATES = [3, 4];

const NEIGHBORS_8: [number, number][] = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

function dedupe(cells: MacroCoord[]): MacroCoord[] {
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const c of cells) {
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Trim the convex outer corners of the painted cells themselves.
 *  Cuttability is ELEVATION-INDEPENDENT, identical to the manual tool: a corner is cut whenever it's an
 *  unlocked convex corner (no same-type edge neighbour pins it) that validates. There is no height gate —
 *  a corner is convex or it isn't, regardless of how tall the stack is, and the renderer draws whatever
 *  sits behind the cut (a lower step, or the ground/water around the mass). */
function cutTerrainOuter(ctx: EdgeCutCtx, cells: MacroCoord[], round: boolean): void {
  for (const { x, y } of cells) {
    const terrain = getCell(ctx.gridState.cells, x, y)?.terrain;
    if (!terrain || terrain.type === TerrainType.None || terrain.patchOnly) continue;

    const locked = computeLockedCorners(ctx.gridState, x, y, 'terrain');
    const before: Corners = terrain.corners
      ? [...terrain.corners]
      : ['square', 'square', 'square', 'square'];
    const after: Corners = [...before];
    let changed = false;
    for (let i = 0; i < 4; i++) {
      if (locked[i]) continue;             // pinned by a same-terrain neighbour (not convex)
      if (before[i] !== 'square') continue;  // keep any existing/manual cut
      after[i] = round ? 'fan' : OUTER_TRI[i]!;
      changed = true;
    }
    if (!changed) continue;
    if (!validateCut(ctx.gridState, x, y, 'terrain', after)) continue;

    ctx.executeCommand({
      type: CommandType.TrimCorners,
      timestamp: Date.now(),
      x, y, layer: 'terrain',
      beforeCorners: before.every((s) => s === 'square') ? undefined : before,
      afterCorners: after,
    } as TrimCornersCommand);
  }
}

/**
 * Fill concave inner corners (Γ-patches) in the notches around the stroke.
 * POLICY AUTO-TRIM-IS-COSMETIC: auto-trim (stroke trim AND generation) never modifies an existing real
 * block — it only trims corners and fills EMPTY notches with Γ fillets (plus the base column a fillet
 * above tier 1 inherently needs). Raising a block the user placed at a deliberate height — or that
 * generation committed — is a constructive edit; only the manual EdgeCutTool does that, on an explicit
 * click. (It would also risk rejected commands via the 3x3-base rule, and generation must stay
 * reject-free by construction.)
 */
function cutTerrainInner(ctx: EdgeCutCtx, cells: MacroCoord[], round: boolean, allowLowerBlock = false): void {
  // Candidate notch cells in the stroke's 8-neighbourhood. A Γ notch can be EMPTY ground, an existing
  // cosmetic patch, OR (stroke path only) a real block LOWER than the same-type mass that wraps it — e.g.
  // the layer-1 base platform under a raised disc, or a mountain peninsula a water hole left behind. The
  // per-corner test below sorts them out.
  const candidates = new Map<string, MacroCoord>();
  for (const p of cells) {
    for (const [dx, dy] of NEIGHBORS_8) {
      const x = p.x + dx, y = p.y + dy;
      const k = `${x},${y}`;
      if (!candidates.has(k)) candidates.set(k, { x, y });
    }
  }

  for (const { x, y } of candidates.values()) {
    const cell = getCell(ctx.gridState.cells, x, y);
    const ref = highestNeighborTerrain(ctx.gridState, x, y);
    if (!ref) continue;
    // GUARD: never fill a notch beside ELEVATED water. A patchOnly trim stores the wrapping tier as its
    // elevation, changing what raw elevation reads see at this cell — inside a waterfall's uniform
    // downstream row (V-WTR-03) or a containment read (V-WTR-02) that flips a legal fall illegal and
    // auto-reverts the WHOLE stroke/generation. Waterfall geometry is exact; a cosmetic fillet is never worth it.
    if (nearElevatedWater(ctx.gridState, x, y)) continue;

    // Gamma fill is MOUNTAIN-only in EVERY path (stroke AND generation), exactly like the manual tool's
    // notch branch ("a WATER notch must NOT be flooded — the island rounds out via the water's concave
    // cut"). A water-wrapped ground notch is a GROUND ISLAND handled by cutGroundIslands; a patchOnly
    // WATER fillet here is a state the manual tool can neither produce nor cycle (its cut-site scan
    // matches no branch), and it cascades (the patch reads as solid water@0, wrapping the next bank
    // cell). Flooding one instead of rounding the ground island would make generated lakes cut
    // differently from hand-painted ones, so generation rounds it exactly as the manual tool does.
    if (ref.type === TerrainType.Water) continue;

    const t = cell?.terrain && cell.terrain.type !== TerrainType.None ? cell.terrain : null;
    const isPatch = !!t?.patchOnly;
    const realBlock = !!t && !isPatch;
    // A real block gets a COSMETIC fillet rounding its inner corner (like a manual Γ click) ONLY when it's a
    // lower, SAME-TYPE notch of the wrapping mass — never raising it (patchBase keeps its real height). This
    // is the stroke path only (`allowLowerBlock`): generation must stay reject-free by construction and a
    // dense map can wrap a mountain block in WATER, so we never fillet a real block there. A block at/above
    // the tier, or of a different type, is structure — skip it.
    const lowerBlock = realBlock && allowLowerBlock && t!.type === ref.type && t!.elevation < ref.elevation;
    if (realBlock && !lowerBlock) continue;
    // A fillet must sit at the tier of the mass that wraps it; an existing patch left BELOW a since-stacked
    // mass is re-issued at the current tier so the rounding tracks the height — but only as far as it can
    // still REST there. Raising a from-empty fillet with the mass leaves it hanging in the air, which is
    // the state `isInnerCorner` refuses to create in the first place.
    const support = surfaceElevation(t);
    const underTall = isPatch && t!.elevation < ref.elevation && ref.elevation === support + 1;

    const before: Corners = (isPatch || lowerBlock) && t!.corners
      ? [...t!.corners]
      : lowerBlock ? ['square', 'square', 'square', 'square'] // a bare lower block keeps its full base
      : ['empty', 'empty', 'empty', 'empty'];
    const after: Corners = [...before];
    let changed = false;
    for (let i = 0; i < 4; i++) {
      if (!isInnerCorner(ctx.gridState, x, y, i, ref.type, ref.elevation)) continue;
      const fill = round ? 'fan' : INNER_TRI[i]!;
      if (after[i] !== fill && (after[i] === 'empty' || after[i] === 'square')) { after[i] = fill; changed = true; }
    }
    if (!changed && !underTall) continue;
    if (after.every((c) => c === 'empty' || c === 'square')) continue;

    if (lowerBlock || isPatch) {
      // Cosmetic patch (matches the manual tool): patchBase = the existing real support, elevation = the
      // wrapping tier. No PaintTerrain, so it never raises a block or trips the 3x3-base rule.
      const patchBase = isPatch ? (t!.patchBase ?? t!.elevation - 1) : t!.elevation;
      ctx.executeCommand({
        type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'terrain',
        beforeCorners: isPatch ? before : undefined, afterCorners: after,
        patchOnly: true, terrainType: ref.type, elevation: ref.elevation, patchBase,
      } as TrimCornersCommand);
    } else {
      // An EMPTY notch fills COSMETICALLY in EVERY path (stroke AND generation), exactly like the manual
      // EdgeCutTool (the single source of truth): a from-empty gamma with patchBase 0 — NO real support
      // column, so the notch stays open ground behind a rounded top corner. Do NOT raiseToTier a solid
      // block here, and never omit patchBase: `patchBase ?? elevation-1` would then fabricate a phantom
      // mountain@N-1 base, visible as a lower step at the inner corner and absent from hand-drawn
      // terrain. Over an empty notch that means tier 1 and no higher — `isInnerCorner` offers the corner
      // only where the fillet RESTS on the notch floor, since a cosmetic fillet cannot hang in the air.
      ctx.executeCommand({
        type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'terrain',
        beforeCorners: undefined, afterCorners: after, patchOnly: true,
        terrainType: ref.type, elevation: ref.elevation, patchBase: 0,
      } as TrimCornersCommand);
    }
  }
}

/**
 * Round GROUND-ISLAND corners the stroke just exposed (STROKE path only): a plain-ground cell whose corner
 * pokes into water — a river bend's inner corner, an island/peninsula tip — rounds OUT, revealing the
 * water it sits in (ISLAND-ROUNDS-REVEALING-WATER). This is exactly the manual tool's ground-island cut
 * (`groundConvexCornerInWater` → a `type: None` cell carrying the OUTER shape), so every cut written here
 * is manual-reachable and manual-cyclable. It is the water counterpart of the mountain Γ fill: water never
 * fills a notch (see cutTerrainInner), the ground rounds instead.
 */
function cutGroundIslands(ctx: EdgeCutCtx, cells: MacroCoord[], round: boolean): void {
  const candidates = new Map<string, MacroCoord>();
  for (const p of cells) {
    for (const [dx, dy] of NEIGHBORS_8) {
      const x = p.x + dx, y = p.y + dy;
      const k = `${x},${y}`;
      if (!candidates.has(k)) candidates.set(k, { x, y });
    }
  }
  for (const { x, y } of candidates.values()) {
    const t = getCell(ctx.gridState.cells, x, y)?.terrain;
    if (t && t.type !== TerrainType.None) continue; // only plain ground / an existing island cut
    const before: Corners = t?.corners ? [...t.corners] : ['square', 'square', 'square', 'square'];
    const after: Corners = [...before];
    let changed = false;
    for (let i = 0; i < 4; i++) {
      if (before[i] !== 'square') continue; // keep any existing/manual cut
      if (!groundConvexCornerInWater(ctx.gridState, x, y, i)) continue;
      after[i] = round ? 'fan' : OUTER_TRI[i]!;
      changed = true;
    }
    if (!changed) continue;
    // No validateCut needed: the cell holds no real terrain, so the terrain-seam contact check is vacuous
    // (the manual tool's applyOuter doesn't validate this cut either).
    ctx.executeCommand({
      type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'terrain',
      beforeCorners: t?.corners ? before : undefined, afterCorners: after,
    } as TrimCornersCommand);
  }
}

/** Whether any 8-neighbour (or the cell itself) is water at elevation >= 1 — the reach within
 *  which a notch fill could sit in a waterfall's downstream row or containment neighbourhood. */
function nearElevatedWater(state: GridState, x: number, y: number): boolean {
  for (const [dx, dy] of [[0, 0], ...NEIGHBORS_8]) {
    const t = getCell(state.cells, x + dx!, y + dy!)?.terrain;
    if (t?.type === TerrainType.Water && t.elevation >= 1) return true;
  }
  return false;
}

/** Trim road end-caps/bends to the requested kind via the canonical states. */
function cutRoads(ctx: EdgeCutCtx, cells: MacroCoord[], round: boolean): void {
  const order = round ? ROUND_STATES : DIRECT_STATES;
  for (const { x, y } of dedupe(cells)) {
    const road = findRoadAt(ctx.gridState, x, y);
    if (!road) continue;
    if (road.corners && !road.corners.every((s) => s === 'square')) continue; // already trimmed

    const conn = detectRoadConn(ctx.gridState, road);
    for (const idx of order) {
      const canonical = CANONICAL_ROAD_STATES[idx];
      if (!canonical) continue;
      const actual = canonicalToActual([...canonical], conn);
      if (!validateCut(ctx.gridState, x, y, 'road', actual)) continue;
      ctx.executeCommand({
        type: CommandType.TrimCorners,
        timestamp: Date.now(),
        x, y, layer: 'road', objectId: road.id,
        beforeCorners: road.corners ? [...road.corners] as Corners : undefined,
        afterCorners: [...canonical],
      } as TrimCornersCommand);
      break;
    }
  }
}

/**
 * Auto-trim the corners of a finished stroke. `terrainCells` are mountain/water
 * cells; `roadCells` are tile/road cells. No-op when mode is 'off'.
 */
export function applyAutoEdgeCut(
  ctx: EdgeCutCtx,
  mode: AutoEdgeCut,
  terrainCells: MacroCoord[],
  roadCells: MacroCoord[],
): void {
  if (mode === 'off') return;
  const round = mode === 'round';
  if (terrainCells.length > 0) {
    const cells = dedupe(terrainCells);
    cutTerrainOuter(ctx, withBorder(cells), round);
    cutTerrainInner(ctx, cells, round, true); // stroke path may fillet a lower same-type block (raised disc on a base)
    cutGroundIslands(ctx, cells, round);      // river bends/tips: ground corners IN water round out (manual-reachable)
  }
  // Roads get the same border sweep as terrain: painting a segment changes a NEIGHBOUR road's
  // connectivity, so a cell just outside the stroke can become a freshly-trimmable end-cap/bend.
  // cutRoads skips already-trimmed roads (manual cuts survive) and interior cells (validateCut
  // forces them square), so the sweep only touches genuinely new cut opportunities.
  if (roadCells.length > 0) cutRoads(ctx, withBorder(dedupe(roadCells)), round);
}

/** A cell set plus its 8-neighbourhood. A stroke can make a NEIGHBOUR's corner newly convex (or a
 *  neighbour road newly an end-cap) without that neighbour being in the stroke — e.g. carving a
 *  water hole into a mountain leaves mountain peninsulas poking into the water, whose corners the
 *  manual tool rounds but a stroke-only pass never visits. The per-cell validators keep the sweep
 *  conservative: only genuinely unlocked, valid cuts land. */
function withBorder(cells: MacroCoord[]): MacroCoord[] {
  return dedupe(cells.flatMap(({ x, y }) => [{ x, y }, ...NEIGHBORS_8.map(([dx, dy]) => ({ x: x + dx, y: y + dy }))]));
}

/**
 * Selective edge-cut for GENERATED terrain: round the convex OUTER corners that computeLockedCorners leaves
 * unlocked (interiors and straight runs stay locked, so only the jagged tips/steps get softened) and fill
 * EMPTY Γ notches. Same elevation-independent cuttability as the manual tool / stroke auto-trim — a convex
 * corner rounds whatever its height, and the renderer draws the lower step or surrounding ground/water
 * behind the cut. Each cut is rejected per-cell by validateCut, so it stays rule-valid by construction.
 * No-op when 'off'.
 */
export function edgeCutGeneratedTerrain(ctx: EdgeCutCtx, terrainCells: MacroCoord[], mode: AutoEdgeCut): void {
  if (mode === 'off' || terrainCells.length === 0) return;
  const cells = dedupe(terrainCells);
  cutTerrainOuter(ctx, cells, mode === 'round');   // round convex tips/steps (cut reveals the surface behind)
  cutTerrainInner(ctx, cells, mode === 'round');   // the Γ case: fill EMPTY concave MOUNTAIN notches (water is skipped)
  cutGroundIslands(ctx, cells, mode === 'round');  // river bends / lake inner corners: ground rounds into water, as the manual path does
}

/** Edge-cut for GENERATED roads — the road mirror of edgeCutGeneratedTerrain, run by the populator
 *  after the road network is paved (same seed-picked mode as the terrain pass, so the whole map
 *  cuts alike). Trims end-caps/bends via the canonical states; interior/through roads stay square
 *  (validateCut forces it), and already-trimmed roads are skipped. */
export function edgeCutGeneratedRoads(ctx: EdgeCutCtx, roadCells: MacroCoord[], mode: AutoEdgeCut): void {
  if (mode === 'off' || roadCells.length === 0) return;
  cutRoads(ctx, roadCells, mode === 'round');
}
