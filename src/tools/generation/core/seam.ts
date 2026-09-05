/**
 * Repairs the boundary of a scoped replacement before commit. Outside terrain may depend on support
 * or water caps inside the region, so flagged inside cells move one tier at a time toward their saved
 * values; other flagged inside cells may lower. Claimed support never lowers again. The live registry
 * decides when the seam is legal, avoiding a duplicate implementation of post-stroke rules.
 */
import { CommandType, TerrainType } from '../../../core/model/types';
import type {
  Command, GridState, MacroCoord, PlacedObject, TerrainCell, ValidationError, ValidationResult,
} from '../../../core/model/types';
import { cellOverlapsRect, flatIndex, getCell, isBuildableZone } from '../../../core/model/grid-model';
import { surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import { entriesNear, getObjectIndex } from '../../../state/object-index';
import { removeObjectCommand } from '../../objects/object-placer';

/** Snapshot of buildable cells before a scoped generation run clears them. */
export interface RegionBase {
  width: number;
  height: number;
  /** 1 for buildable cells inside the region; seam repair edits only these cells. */
  mask: Uint8Array;
  /** What each in-region cell held before the run, by flat index. */
  before: (TerrainCell | null)[];
}

export interface SeamContext {
  state: GridState;
  execute: (cmd: Command) => ValidationResult;
  reg: RuleDispatcher;
}

export interface SeamOptions {
  /** Objects the caller preserves; their occupied cells are not edited. */
  spare?: (obj: PlacedObject) => boolean;
}

export interface SeamRepair {
  /** Distinct in-region cells moved toward their saved terrain. */
  restored: number;
  /** In-region cells that gave up a tier instead, counted the same way. */
  lowered: number;
  /** In-region cells reserved to satisfy outside dependencies, whether restoration landed or not. */
  claimed: number;
  passes: number;
  /** Remaining violations after the repair bound is reached. */
  violations: ValidationError[];
}

/** Safety bound for tier-by-tier restoration across expanding support rings. */
const MAX_PASSES = 64;
/** How far into the region a flagged cell outside it may reach for support. Grown one ring at a time
 *  and only when a pass achieved nothing, so the usual answer (V-MTN-03's own 3x3) costs one ring. */
const MAX_REACH = 12;

/** Captures buildable terrain before a run clears its scope. */
export function readRegionBase(state: GridState, region: readonly MacroCoord[]): RegionBase {
  const { width, height } = state.template;
  const mask = new Uint8Array(width * height);
  const before: (TerrainCell | null)[] = new Array(width * height).fill(null);
  for (const c of region) {
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) continue;
    const cell = getCell(state.cells, c.x, c.y);
    if (!cell || !isBuildableZone(cell.zone)) continue;
    const i = flatIndex(c.x, c.y, width);
    mask[i] = 1;
    before[i] = cell.terrain ? { ...cell.terrain } : null;
  }
  return { width, height, mask, before };
}

/** The mass a cell reaches: what every rule reads it as, a Γ patch's cosmetic tier included. */
const mass = (terrain: TerrainCell | null): number => (terrain ? surfaceElevation(terrain) : 0);

/** What a cell holds, as far as any rule is concerned: its kind and the mass it reaches. */
function signature(terrain: TerrainCell | null): string {
  return terrain ? `${terrain.type}:${surfaceElevation(terrain)}` : '-';
}

/**
 * Reports whether a completed run left no generated content in its region.
 * Any object, new terrain type, new occupied cell, or mass above the pre-run snapshot counts as generated content.
 * Same-type terrain at or below its prior mass may be seam support and does not count.
 */
export function regionUnbuilt(state: GridState, base: RegionBase): boolean {
  const { width: W, height: H, mask, before } = base;
  let x1 = W, y1 = H, x2 = -1, y2 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i] === 0) continue;
      const now = getCell(state.cells, x, y)?.terrain ?? null, was = before[i] ?? null;
      if (now && (mass(now) > mass(was) || !was || now.type !== was.type)) return false;
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x > x2) x2 = x;
      if (y > y2) y2 = y;
    }
  }
  if (x2 < 0) return true;
  for (const entry of entriesNear(getObjectIndex(state), { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 })) {
    const { rect } = entry;
    for (let y = Math.max(y1, Math.floor(rect.y) - 1); y <= Math.min(y2, Math.ceil(rect.y + rect.h)); y++) {
      for (let x = Math.max(x1, Math.floor(rect.x) - 1); x <= Math.min(x2, Math.ceil(rect.x + rect.w)); x++) {
        if (mask[y * W + x] === 1 && cellOverlapsRect(rect, x, y, -0.5)) return false;
      }
    }
  }
  return true;
}

/** One tier towards the ground the cell held, or undefined when it is already there. */
function towards(now: TerrainCell | null, was: TerrainCell | null): TerrainCell | null | undefined {
  const want = mass(was), have = mass(now);
  if (have === want) return signature(now) === signature(was) ? undefined : was;
  const next = have < want ? have + 1 : have - 1;
  if (next === want) return was;
  return next === 0 ? null : { type: TerrainType.Mountain, elevation: next };
}

/** The one tier a flagged in-region cell can give up. Undefined when it holds nothing left to give. */
function lowerOf(terrain: TerrainCell | null): TerrainCell | null | undefined {
  if (!terrain) return undefined;
  if (terrain.type === TerrainType.Water || terrain.patchOnly) return null;
  const top = surfaceElevation(terrain);
  return top > 1 ? { type: TerrainType.Mountain, elevation: top - 1 } : null;
}

/** In-region cells within `reach`, returned in deterministic raster order. */
function within(i: number, reach: number, base: RegionBase): number[] {
  const { width: W, height: H, mask } = base;
  const cx = i % W, cy = (i / W) | 0;
  const out: number[] = [];
  for (let y = Math.max(0, cy - reach); y <= Math.min(H - 1, cy + reach); y++) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(W - 1, cx + reach); x++) {
      const j = y * W + x;
      if (mask[j] === 1) out.push(j);
    }
  }
  return out;
}

/**
 * Applies seam targets bottom-up so each terrain tier has support, removing non-spared objects first.
 * Returns target indices that reached the requested terrain state.
 */
function applyTargets(
  ctx: SeamContext, targets: Map<number, TerrainCell | null>, W: number, spare?: (obj: PlacedObject) => boolean,
): number[] {
  const { state, execute } = ctx;
  const index = getObjectIndex(state);
  const held = new Set<number>();
  const removed = new Set<string>();
  for (const i of targets.keys()) {
    const x = i % W, y = (i / W) | 0;
    for (const entry of entriesNear(index, { x: x - 2, y: y - 2, w: 5, h: 5 })) {
      if (removed.has(entry.obj.id) || !cellOverlapsRect(entry.rect, x, y, -0.5)) continue;
      if (entry.obj.locked || spare?.(entry.obj)) { held.add(i); continue; }
      if (execute(removeObjectCommand(entry.obj)).success) removed.add(entry.obj.id);
    }
  }
  for (const i of held) targets.delete(i);

  const coords: MacroCoord[] = [...targets.keys()].sort((a, b) => a - b)
    .map((i) => ({ x: i % W, y: (i / W) | 0 }));
  if (coords.length === 0) return [];

  const bare = coords.filter((c) => targets.get(flatIndex(c.x, c.y, W)) === null);
  if (bare.length > 0) {
    const erase: Command = { type: CommandType.EraseTerrain, timestamp: 0, cells: bare };
    if (!execute(erase).success) {
      for (const c of bare) execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: [c] });
    }
  }

  let maxTier = 0, maxWater = -1;
  for (const terrain of targets.values()) {
    if (!terrain) continue;
    if (terrain.type === TerrainType.Water) maxWater = Math.max(maxWater, mass(terrain));
    else maxTier = Math.max(maxTier, mass(terrain));
  }
  const layer = (type: TerrainType, elevation: number, keep: (t: TerrainCell) => boolean): void => {
    const cells = coords.filter((c) => {
      const terrain = targets.get(flatIndex(c.x, c.y, W));
      return !!terrain && keep(terrain);
    });
    if (cells.length === 0) return;
    const cmd: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: type, elevation };
    if (execute(cmd).success) return;
    for (const c of cells) {
      execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [c], terrainType: type, elevation });
    }
  };
  for (let L = 1; L <= maxTier; L++) {
    layer(TerrainType.Mountain, L, (t) => t.type !== TerrainType.Water && mass(t) >= L);
  }
  for (let L = 0; L <= maxWater; L++) {
    layer(TerrainType.Water, L, (t) => t.type === TerrainType.Water && mass(t) >= L);
  }

  const landed: number[] = [];
  for (const c of coords) {
    const i = flatIndex(c.x, c.y, W);
    const want = targets.get(i) ?? null;
    if (signature(getCell(state.cells, c.x, c.y)?.terrain ?? null) === signature(want)) landed.push(i);
  }
  return landed;
}

/** Repairs a scoped run after generation and before commit, using the caller's command path and undo group. */
export function repairRegionSeam(ctx: SeamContext, base: RegionBase, opts: SeamOptions = {}): SeamRepair {
  const { state, reg } = ctx;
  const { width: W, height: H, mask, before } = base;
  /** 1 where restoration owns the cell, preventing a later lowering step from reversing it. */
  const claimed = new Uint8Array(W * H);
  /** Distinct changed cells; repeated tier steps count once. */
  const movedBack = new Set<number>(), movedDown = new Set<number>();
  let violations = reg.validatePostStroke(state);
  let reach = 1, passes = 0;

  while (violations.length > 0 && passes < MAX_PASSES) {
    passes++;
    const giveBack = new Map<number, TerrainCell | null>();
    const takeFrom = new Map<number, TerrainCell | null>();
    const terrainAt = (i: number): TerrainCell | null =>
      getCell(state.cells, i % W, (i / W) | 0)?.terrain ?? null;

    for (const violation of violations) {
      for (const c of violation.cells) {
        if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) continue;
        const i = flatIndex(c.x, c.y, W);
        if (mask[i] === 1 && claimed[i] === 0) {
          const give = lowerOf(terrainAt(i));
          if (give !== undefined) takeFrom.set(i, give);
          continue;
        }
        // Outside the region, or already claimed: what can still change is the ground inside it.
        for (const j of within(i, reach, base)) {
          const step = towards(terrainAt(j), before[j] ?? null);
          if (step !== undefined) giveBack.set(j, step);
        }
      }
    }
    // A cell owed to the outside walks back; it is not also asked to give mass up.
    for (const i of giveBack.keys()) takeFrom.delete(i);

    let changed = 0;
    if (giveBack.size > 0) {
      const asked = [...giveBack.keys()];
      for (const i of applyTargets(ctx, giveBack, W, opts.spare)) { movedBack.add(i); changed++; }
      // Claimed whether or not the paint landed. A claimed cell may keep walking back tier by tier;
      // what it may not do is give mass up again, which is what would put the two moves in a cycle.
      for (const i of asked) claimed[i] = 1;
    }
    if (takeFrom.size > 0) {
      for (const i of applyTargets(ctx, takeFrom, W, opts.spare)) { movedDown.add(i); changed++; }
    }
    if (changed === 0) {
      if (reach >= MAX_REACH) break;
      reach++;
      continue;   // nothing moved, so nothing to re-validate
    }
    violations = reg.validatePostStroke(state);
  }

  let owed = 0;
  for (const flag of claimed) if (flag === 1) owed++;
  return { restored: movedBack.size, lowered: movedDown.size, claimed: owed, passes, violations };
}
