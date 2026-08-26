/**
 * A SCOPED RUN AND THE GROUND AROUND IT: giving back whatever the map outside the region leans on.
 *
 * A run confined to a painted region REPLACES its scope — it erases the terrain inside and builds its
 * own there — and the ground OUTSIDE is not its to touch. But the outside LEANS ON the inside. A
 * mountain one cell beyond the boundary at layer 6 needs a full 3x3 of mass at layer 3 under it, and
 * three of those nine cells are inside the region; an elevated pond is capped by mountain at exactly
 * its own layer, and the cap can be inside. Erase either and the map is illegal at a cell the run
 * never touched. Both rules are POST-stroke, so the violation arrives at commit time and the executor
 * unwinds the stroke until the state is clean again — which means unwinding the run's own clearing,
 * the very thing that broke it. The whole run disappears, every time, whatever it built.
 *
 * SO THE SEAM IS SETTLED BEFORE THE COMMIT, AND IT IS SETTLED BY GIVING GROUND BACK. The map as it
 * stood was legal, so the terrain each in-region cell HELD is a legal answer for the ground outside by
 * construction — which is why no rule is re-implemented here. The repair validates through the live
 * registry and moves the cells the registry flags, the same way `repair.ts` certifies a plan.
 *
 *   - a flagged cell OUTSIDE the region cannot be edited, so the ground INSIDE the region around it
 *     moves ONE TIER back towards what it was.
 *   - a flagged cell INSIDE the region gives up a tier instead (`repair.ts`'s decrease-only step),
 *     unless the seam has already claimed it, in which case it moves towards what it was as well.
 *
 * ONE TIER AT A TIME, AND NOT STRAIGHT BACK TO WHAT IT WAS, because the least that satisfies the
 * outside is usually far less than the whole cell: a layer-8 mountain over the boundary asks for
 * layer 5 under it and nothing more, and 5 asks for 2 one cell further in, so a seam two cells deep
 * settles a massif of any height. Handing back the cell's full height instead demands ITS full
 * support one ring deeper, and that ring the next — measured, a region across a tall picture gave back
 * a quarter of itself, and a region inside a plateau gave back all of it. Every cell still ends at
 * what it held if that is what it takes, so the worst case is the map the run started from, which is
 * legal; the loop simply stops at the first legal state on the way there.
 *
 * The moves cannot fight each other: each cell walks towards ONE value (the ground it had), a tier per
 * pass, and a cell the seam has claimed is never asked to give mass up again. So the loop terminates,
 * and it terminates on a map the rules accept unless the region genuinely has nothing left to offer —
 * a region painted deep inside a layer-8 massif is a place where flat ground is not legal at all, and
 * there the honest answer is the ground that was already there.
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

/** The ground a run is about to replace, read before it clears anything. */
export interface RegionBase {
  width: number;
  height: number;
  /** 1 where a cell is inside the region AND buildable: the only cells the repair may edit. */
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
  /** Objects the caller has undertaken to leave standing (Clear spares the person's own work). A cell
   *  one of them covers is left alone: terrain cannot be painted under an object, and the clearing
   *  spared that cell for the same reason, so the seam never needs it. */
  spare?: (obj: PlacedObject) => boolean;
}

export interface SeamRepair {
  /** How many in-region cells the seam claimed: cells moved back towards the ground they held,
   *  counted once each however many tiers they walked. */
  restored: number;
  /** In-region cells that gave up a tier instead, counted the same way. */
  lowered: number;
  /** In-region cells the seam CLAIMED for the ground outside, whether or not the paint that walked
   *  them back landed. What the outside was owed, as opposed to what was handed over: a region whose
   *  every cell is claimed is a region the run had nothing left to build on. */
  claimed: number;
  passes: number;
  /** What is still wrong. Empty on a settled seam, which is the point: the executor's auto-revert
   *  stays a backstop rather than the way a scoped run ends. */
  violations: ValidationError[];
}

/** A cell walks back one tier per pass, so a layer-8 seam takes eight; a few rings of that, plus the
 *  headroom a pathological map needs. A safety bound, not a working budget (measured: 7). */
const MAX_PASSES = 64;
/** How far into the region a flagged cell outside it may reach for support. Grown one ring at a time
 *  and only when a pass achieved nothing, so the usual answer (V-MTN-03's own 3x3) costs one ring. */
const MAX_REACH = 12;

/** The ground inside the region, as it stands. Call BEFORE the run clears its scope. */
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
 * Is there nothing of the run's own left in its region? Read AFTER the commit.
 *
 * TRUE means the press built nothing, and there are two reasons a scoped press ends that way. The
 * ground may never have been the run's to build on: a region painted inside a tall massif is ground
 * the outside leans on, so the seam claims it and hands it back, and flat ground is not legal there
 * at any tier. Or the region may have been perfectly free and the island's design simply put nothing
 * in it. The caller tells the two apart by whether the seam claimed anything (`SeamRepair.claimed`)
 * and says which, because a press that appears to do nothing and says nothing reads as a broken
 * button.
 *
 * WHAT THE READING TESTS is that no cell holds MORE than it held before the run and no object stands
 * in the region at all. Not equality with the ground before: the seam settles at the least the outside
 * needs, which is usually LOWER than the cell's own height, so a region handed back is a region full
 * of cells that differ from what they were. What only the run can produce is mass ABOVE what a cell
 * held, or a placement of any kind — its own clearing emptied the scope first, so whatever stands
 * there afterwards arrived with it. A cell walked back through a tier of mountain where it used to
 * hold water reads as built, which keeps the notice off a press whose result is not plainly nothing.
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
  if (x2 < 0) return true;   // no buildable cell in scope: nothing was ever going to be built
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

/** The in-region cells within `reach` of a flat index, in raster order so a repair is one function of
 *  the map rather than of the order the region was painted in. */
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
 * Put `targets` on the map, bottom-up.
 *
 * BOTTOM-UP FOR THE SAME REASON `commit.ts` IS: painting layer N wants layer N-1 already under it
 * (V-MTN-02/V-WTR-01), so a cell coming back at layer 6 is painted at 1, 2, 3… up to its own height.
 * The layers are emitted over the target list rather than through `planToCommands`, which walks the
 * whole grid per layer — the right shape for an island plan and the wrong one for a seam.
 *
 * Objects go first, because terrain cannot be painted under one (V-PLACE-BLOCK) and what stands on the
 * ground being given back is the run's own placement. A spared object keeps its cell instead.
 *
 * Returns the targets that reached the state they were asked for.
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

/**
 * Make the map legal again at the seam of a scoped run, editing nothing outside the region.
 *
 * Run after the build and before the commit. Every command goes through the caller's own door, so the
 * repair joins the run's stroke group (one undo entry) and its record (a candidate replays it).
 */
export function repairRegionSeam(ctx: SeamContext, base: RegionBase, opts: SeamOptions = {}): SeamRepair {
  const { state, reg } = ctx;
  const { width: W, height: H, mask, before } = base;
  /** 1 where the seam has claimed a cell: it walks towards the ground it had and is never asked to
   *  give mass up again, which is what keeps the two moves from undoing each other. */
  const claimed = new Uint8Array(W * H);
  /** Cells this repair actually moved, so a caller hears how much of the region the seam cost rather
   *  than how many tiers it walked. */
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
