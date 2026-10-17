/**
 * Transfers a build by aligning source and destination anchor landmark centres, clearing the
 * destination's own terrain under the carried build, repairing terrain against the new template,
 * and replaying terrain, corners, then objects through live rules, with the plan notes moved by the
 * same offset (`annotations.ts`). Paint batches split on refusal and land and build use separate
 * strokes. Work occurs on a detached map; `editor/operations/transfer-map.ts`
 * installs it when complete. Existing cell/object provenance is translated with the content. Nothing
 * here reaches the live editor, so the generation worker runs this module for the carry preview.
 */
import { eraseTerrainCommand, paintTerrainCommand, placeObjectCommand, removeObjectCommand, trimTerrainCommand } from '../../../core/model/command-build';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import { getCell } from '../../../core/model/grid-model';
import { hasLandmark, isLandmarkItem, templateAnchor } from '../../../core/model/landmarks';
import { cellKey } from '../../../core/grid/rect';
import { terrainCellsUnder, footprintCells } from '../../../core/grid/footprint';
import type { GridCellRef, GridId } from '../../../core/grid/grids';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { isBuildableZone } from '../../../core/game/zones';
import { isCoating } from '../../../core/model/traits';
import { createGridState, templateHasTerrain } from '../../../core/model/template';
import { structuralTop, patchSupport } from '../../../core/domain/terrain/terrain-surface';
import { ProvSource } from '../../../core/provenance/types';
import {
  TerrainType,
  type GridState,
  type MacroCoord,
  type MapTemplate,
  type PaintTerrainCommand,
  type PlacedObject,
  type TerrainCell,
  type TrimCornersCommand,
  type ValidationError,
} from '../../../core/model/types';
import { copyCorners } from '../../../core/model/corners';
import { createDefaultRegistry } from '../../../rules';
import type { RuleRegistry } from '../../../rules/registry';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { getObjectIndex, objectAt } from '../../../state/object-index';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { backOffAt, type BackOffOptions, type SettleActions } from '../../../state/settle';
import { planToCommands, repairPlan, type TerrainPlan } from '../terrain-plan';
import { movedObject } from '../../placement/probe';
import { carriedNotes } from './annotations';

/** Cells and objects are counted apart, because the report names both. */
export interface TransferCounts {
  cells: number;
  objects: number;
}

/** Round to the macro grid with halves away from zero, so a distance and its reverse round to
 *  opposite whole cells, and a negative zero comes back as 0. */
const macroRound = (v: number): number => Math.sign(v) * Math.round(Math.abs(v)) || 0;

/** The point a planet is anchored at: the centre of its anchor landmark, which is what the two maps
 *  are laid over each other by; a template without one falls back to its middle, which is the only
 *  other thing two maps of different sizes share. */
function anchorPoint(t: MapTemplate): { x: number; y: number } {
  const p = templateAnchor(t);
  if (!hasLandmark(p)) return { x: t.width / 2, y: t.height / 2 };
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
}

/** How far everything moves between two planets, in whole cells: terrain moves cell for cell, so
 *  the shift between anchors half a cell apart rounds, and the way back is its exact reverse. */
export function anchorOffset(from: MapTemplate, to: MapTemplate): MacroCoord {
  const a = anchorPoint(from);
  const b = anchorPoint(to);
  return { x: macroRound(b.x - a.x), y: macroRound(b.y - a.y) };
}

/** A landmark of the map being left. The destination made its own from its own template, and
 *  V-LOCK-02 would refuse this one anyway. */
const isLandmark = (o: PlacedObject): boolean => isLandmarkItem(o.catalogId);

/** Row-major indices of the terrain cells `state`'s landmarks rest on. A transfer leaves the
 *  landmarks behind and the ground they stand on with them: each planet's landmark keeps its own,
 *  and no paint could lay a carried cell under it. */
function landmarkGround(state: GridState): Set<number> {
  const { width, height } = state.template;
  const ground = new Set<number>();
  for (const o of state.objects.values()) {
    if (!isLandmark(o)) continue;
    const { w, h } = getPlacedObjectSize(o);
    for (const c of terrainCellsUnder({ x: o.position.x, y: o.position.y, w, h })) {
      if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) ground.add(c.y * width + c.x);
    }
  }
  return ground;
}

/** The terrain a transfer carries off `state` at (x, y): the cell's own, none under a landmark. */
function carriedTerrain(state: GridState): (x: number, y: number) => TerrainCell | null | undefined {
  const w = state.template.width;
  const behind = landmarkGround(state);
  return (x, y) => (behind.has(y * w + x) ? null : state.cells[y]?.[x]?.terrain);
}

/**
 * Whether this map holds anything a transfer would carry.
 *
 * The same predicate `countCarried` counts by, so a caller that skips the transfer for an empty map
 * can never skip one that had something to move. A cell holding terrain counts however low it sits:
 * a ground-level edge cut is a `None` cell at elevation 0 with corners, which occupies no layer and
 * is invisible to any per-layer tally, and it is exactly the kind of work a silent skip would drop.
 * A plan note counts too: a map holding only notes still has them to carry.
 */
export function hasCarriableContent(state: GridState): boolean {
  if (state.annotations?.items.length) return true;
  for (const o of state.objects.values()) if (!isLandmark(o)) return true;
  const terrainAt = carriedTerrain(state);
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) if (terrainAt(x, y)) return true;
  }
  return false;
}

/** A transfer's arrival on a detached map, before anything is installed. */
export interface BuiltTransfer {
  dest: GridState;
  registry: RuleRegistry;
  offset: MacroCoord;
  moved: TransferCounts;
  dropped: TransferCounts;
  /** Every destination cell that would have held carried terrain (on the terrain grid), part of a
   *  carried object's footprint or a plan note left behind (`carriedNotes`, both on the placement
   *  grid) and does not, cells off the destination included; each cell once, and no placement cell
   *  the lost terrain already covers whole. */
  droppedCells: GridCellRef[];
  violations: ValidationError[];
}

/**
 * The whole transfer on a detached destination. Reads `source` and touches nothing live, so the
 * real transfer and its preview are one computation.
 *
 * The destination starts as a fresh state of `target`, the planet's own terrain included. Wherever
 * the source holds terrain or a carried object stands, that terrain is cleared first: the build
 * replaces the planet's mountains where the two overlap.
 */
export function buildTransfer(source: GridState, target: MapTemplate): BuiltTransfer {
  const offset = anchorOffset(source.template, target);
  const registry = createDefaultRegistry();
  // The destination as `initMap` builds it: the template's own zones, terrain and landmark objects.
  const dest = createGridState(target);
  dest.ignoreChunkLoad = source.ignoreChunkLoad;
  clearUnderBuild(source, dest, offset);
  const executor = createExecutor(dest, registry);

  const violations = executor.transaction({ source: { source: ProvSource.Imported, tool: 'transfer' } }, (): ValidationError[] => {
    // Silenced for the reason a generation is: a refusal here is an outcome the report counts, not
    // an error to raise per cell.
    const paintable = paintableMask(dest, registry);
    // The land first, as its own stroke; its cuts commit with it.
    executor.transaction({}, (tx) => {
      executor.transaction({ silent: true }, () => {
        replayTerrain(source, dest, { executor, registry }, offset, paintable);
        replayCorners(source, dest, executor, offset, paintable);
      });
      tx.commit();
    });
    const settled = settleArrival(dest, executor, registry);

    // The build is only offered to land that stands. A stroke laid over an illegal map is judged
    // against the whole map, so the build stroke's own commit would find the land's violations and
    // unwind every object on the way to a map it cannot fix — the loss lands on the content that
    // was never the problem. Ground that will not settle arrives bare, and the report says so.
    if (settled.length > 0) return settled;
    executor.transaction({}, (tx) => {
      executor.transaction({ silent: true }, () => replayObjects(source, dest, executor, offset));
      tx.commit();
    });
    // What the map still says about itself, rather than what a commit said on its way to fixing
    // it: `commitStroke` returns the violations it found and then reverts until they are gone, so
    // its answer describes a map that no longer stands.
    return settleArrival(dest, executor, registry);
  });

  // The work's own history comes along with the work: what the replay dropped stays behind
  // (`keepCell`/`keepObject` read the arrival), and what landed keeps its author.
  if (source.provenance) {
    executor.getAuthorship().adoptTransplant(
      source.provenance, offset,
      (x, y) => !!getCell(dest.cells, x, y)?.terrain,
      (id) => dest.objects.has(id),
    );
  }

  // The notes are the build's (its title, who made it), not the planet's, so they come along. The
  // generation recipe does not: it named a map on another template, and this one no longer replays
  // from it.
  if (source.notes) dest.notes = { ...source.notes };
  const notes = carriedNotes(source.annotations, offset, target);
  if (notes.annotations) dest.annotations = notes.annotations;

  const { moved, dropped, droppedCells } = countCarried(source, dest, offset, notes.lost);
  return { dest, registry, offset, moved, dropped, droppedCells, violations };
}

/** The destination cells a carried object's footprint covers on the zone and object grid, a
 *  half-step anchor included. */
function carriedFootprint(o: PlacedObject, offset: MacroCoord): MacroCoord[] {
  const { w, h } = getPlacedObjectSize(o);
  return footprintCells(o.position.x + offset.x, o.position.y + offset.y, w, h);
}

/** The destination terrain cells a carried object rests on. Terrain sits half a cell up-left of the
 *  object grid, so a whole-cell footprint rests on one more column and row than it covers. */
function carriedGround(o: PlacedObject, offset: MacroCoord): MacroCoord[] {
  const { w, h } = getPlacedObjectSize(o);
  return terrainCellsUnder({ x: o.position.x + offset.x, y: o.position.y + offset.y, w, h });
}

/** Clears the planet's own terrain from every destination cell a source terrain cell lands on and
 *  every terrain cell a carried object rests on, except the ground the destination's landmarks
 *  stand on (`landmarkGround`). Runs on the fresh scratch state before any
 *  executor has read it. */
function clearUnderBuild(source: GridState, dest: GridState, offset: MacroCoord): void {
  if (!templateHasTerrain(dest.template)) return;
  const terrainAt = carriedTerrain(source);
  const kept = landmarkGround(dest);
  const clear = (x: number, y: number): void => {
    if (kept.has(y * dest.template.width + x)) return;
    const cell = getCell(dest.cells, x, y);
    if (cell) cell.terrain = null;
  };
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) if (terrainAt(sx, sy)) clear(sx + offset.x, sy + offset.y);
  }
  for (const o of source.objects.values()) {
    if (isLandmark(o)) continue;
    for (const c of carriedGround(o, offset)) clear(c.x, c.y);
  }
}

// ── terrain ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Where the destination will take terrain at all, asked of the rules rather than re-derived.
 *
 * A one-cell probe answers it: what refuses a paint is the zone, the half-cell bleed onto the
 * up/left neighbours, and an object standing in the way (a landmark) — none of which any later paint
 * changes, so one answer per cell holds for the whole replay. The probe runs after
 * `clearUnderBuild`, so every cell the build lands on is empty ground and the planet's own terrain
 * stands only around it. The mask has to be applied before the plan is repaired: `repairPlan`
 * certifies the plan as it would stand, and a plan holding cells the map will refuse certifies a map
 * that never arrives, leaving the real one a support cell short and the whole stroke reverted at
 * commit.
 */
function paintableMask(dest: GridState, registry: RuleRegistry): (x: number, y: number) => boolean {
  const { width, height } = dest.template;
  const known = new Uint8Array(width * height); // 0 = unasked, 1 = yes, 2 = no
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = y * width + x;
    const seen = known[i]!;
    if (seen !== 0) return seen === 1;
    const cell = getCell(dest.cells, x, y);
    // The zone test is the probe's own first question (V-ZONE-01 reads this same predicate); asking
    // it here keeps the open sea from allocating a command per cell.
    let ok = !!cell && isBuildableZone(cell.zone);
    if (ok) {
      const probe: PaintTerrainCommand = paintTerrainCommand([{ x, y }], TerrainType.Mountain, 1);
      ok = registry.validatePreCommand(probe, dest).length === 0;
    }
    known[i] = ok ? 1 : 2;
    return ok;
  };
}

/** The mass a source cell carries: a real block's full height, a Γ patch's real base (the fillet is
 *  cosmetic and is replayed as a corner), nothing for a `None` islet cut. −1 = no mass. */
function carriedMass(t: TerrainCell): number {
  if (t.type === TerrainType.None) return -1;
  const top = structuralTop(t);
  if (t.type === TerrainType.Mountain) return top >= 1 ? top : -1;
  return t.patchOnly && top < 1 ? -1 : top;   // a from-empty water fillet holds no water
}

/** The carried terrain as a plan on the destination's grid. */
function carriedPlan(
  source: GridState,
  target: MapTemplate,
  offset: MacroCoord,
  paintable: (x: number, y: number) => boolean,
): TerrainPlan {
  const terrainAt = carriedTerrain(source);
  const plan: TerrainPlan = {
    width: target.width,
    height: target.height,
    tier: new Int8Array(target.width * target.height),
    water: new Int8Array(target.width * target.height).fill(-1),
  };
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      const t = terrainAt(sx, sy);
      if (!t) continue;
      const mass = carriedMass(t);
      if (mass < 0) continue;
      const dx = sx + offset.x, dy = sy + offset.y;
      if (!paintable(dx, dy)) continue;
      const i = dy * target.width + dx;
      if (t.type === TerrainType.Mountain) plan.tier[i] = mass;
      else plan.water[i] = mass;
    }
  }
  return plan;
}

/** Apply one layer paint, splitting it in half on refusal down to the single cells that are the
 *  actual refusal. Cells within a paint are judged independently (zone, bleed, support under the
 *  cell itself), so a half that stands is the same map as the whole would have been. */
function applyPaint(executor: CommandExecutor, cmd: PaintTerrainCommand): void {
  if (executor.execute(cmd).success || cmd.cells.length <= 1) return;
  const mid = cmd.cells.length >> 1;
  applyPaint(executor, { ...cmd, cells: cmd.cells.slice(0, mid) });
  applyPaint(executor, { ...cmd, cells: cmd.cells.slice(mid) });
}

function replayTerrain(
  source: GridState,
  dest: GridState,
  edit: { executor: CommandExecutor; registry: RuleRegistry },
  offset: MacroCoord,
  paintable: (x: number, y: number) => boolean,
): void {
  const { executor, registry } = edit;
  // The ground the destination's landmarks stand on is already on the map: the repair reads it as
  // the walls and banks it is, and no paint lays it again.
  const kept = landmarkGround(dest);
  const plan = carriedPlan(source, dest.template, offset, paintable);
  for (const i of kept) {
    const t = dest.cells[Math.floor(i / plan.width)]?.[i % plan.width]?.terrain;
    if (t?.type === TerrainType.Mountain) plan.tier[i] = t.elevation;
    else if (t?.type === TerrainType.Water) plan.water[i] = t.elevation;
  }
  const repaired = repairPlan(plan, dest.template, registry);
  for (const i of kept) { repaired.tier[i] = 0; repaired.water[i] = -1; }
  for (const cmd of planToCommands(repaired, null)) applyPaint(executor, cmd);
}

// ── silhouette ───────────────────────────────────────────────────────────────────────────────────

/**
 * The carried edge cuts, once the mass they sit on is standing.
 *
 * A cut is offered only where the destination cell holds exactly what it describes: the same block
 * at the same tier, or the empty notch a from-empty fillet needs. What survives that test and still
 * does not hold is dropped by `reconcileCuts` when the stroke commits.
 *
 * Before the objects: a Γ patch materialises terrain on its cell, so V-PLACE-BLOCK refuses it under
 * anything standing there. The from-empty cuts take the paint mask: a from-empty fillet or a
 * ground-islet cut puts terrain on an empty cell, and V-ZONE-01 does not read a TrimCorners.
 */
function replayCorners(
  source: GridState,
  dest: GridState,
  executor: CommandExecutor,
  offset: MacroCoord,
  paintable: (x: number, y: number) => boolean,
): void {
  const terrainAt = carriedTerrain(source);
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      const t = terrainAt(sx, sy);
      if (!t?.corners) continue;
      const dx = sx + offset.x, dy = sy + offset.y;
      const cell = getCell(dest.cells, dx, dy);
      if (!cell) continue;
      const now = cell.terrain;
      const corners = copyCorners(t.corners);
      const cut: TrimCornersCommand = trimTerrainCommand(dx, dy, corners);
      if (t.patchOnly) {
        const base = patchSupport(t);
        const standing = base < 1
          ? now === null && paintable(dx, dy)
          : !!now && !now.patchOnly && now.type === t.type && now.elevation === base;
        if (!standing) continue;
        executor.execute({
          ...cut, patchOnly: true, terrainType: t.type, elevation: t.elevation, patchBase: base,
        });
      } else if (t.type === TerrainType.None) {
        // The islet cut carries no mass: anything standing here is not what it rounds.
        if (now || !paintable(dx, dy)) continue;
        executor.execute(cut);
      } else {
        if (!now || now.patchOnly || now.type !== t.type || now.elevation !== t.elevation) continue;
        executor.execute(cut);
      }
    }
  }
}

// ── objects ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The carried objects, solids before coatings, each offered on its own.
 *
 * A coating is laid last so it lands on the surface it coats rather than under the house that is
 * about to stand on it. Every object keeps its ID: the destination holds nothing but its own
 * landmarks, so the source's ids are unique there by construction, and a re-minted id would make
 * two runs of one transfer produce different maps. `movedObject` re-reads the elevation from the destination's
 * own surface — the mass under an object can arrive a tier lower than it left.
 */
function replayObjects(
  source: GridState,
  dest: GridState,
  executor: CommandExecutor,
  offset: MacroCoord,
): void {
  const solids: PlacedObject[] = [];
  const coatings: PlacedObject[] = [];
  for (const o of source.objects.values()) {
    if (isLandmark(o)) continue;
    const item = getCatalogItem(o.catalogId);
    (item && isCoating(item) ? coatings : solids).push(o);
  }
  for (const o of [...solids, ...coatings]) {
    const carried = movedObject(dest, o, o.position.x + offset.x, o.position.y + offset.y);
    // The spread in `movedObject` is shallow, and the two maps must share no mutable member.
    if (o.corners) carried.corners = copyCorners(o.corners);
    executor.execute(placeObjectCommand(carried));
  }
}

// ── settling ─────────────────────────────────────────────────────────────────────────────────────

/** Rounds an arrival gets to answer for itself. Each one takes mass or an object off the map, so
 *  the loop is short by construction; the cap is a backstop, not a schedule. */
const SETTLE_ROUNDS = 8;

/** The arrival's removals, as commands on its own executor, and the object a flagged cell may give
 *  up: an unlocked one that is not a landmark. */
function arrivalBackOff(dest: GridState, executor: CommandExecutor): { act: SettleActions; opts: BackOffOptions } {
  return {
    act: {
      eraseTerrain: (c) => executor.execute(eraseTerrainCommand([c])).success,
      removeObject: (obj) => executor.execute(removeObjectCommand(obj)).success,
    },
    opts: {
      standingAt: (c) => {
        const obj = objectAt(getObjectIndex(dest), c);
        return obj && !obj.locked && !isLandmark(obj) ? obj : null;
      },
    },
  };
}

/**
 * Take back whatever the arrived map still flags, and report what it flags after that.
 *
 * `commitStroke` runs its reconcile passes after its own post-stroke validation, and a carried Γ
 * fillet whose wrapping context did not survive the move is dropped there, which can leave the
 * block beside it standing on nothing; so the arrival reads the map once more. Decrease-only, like
 * the plan repair, so it converges and never invents terrain the visitor did not build.
 *
 * A round is collapsed (`Stroke.collapse`), never committed: `commitStroke` reverts a stroke while
 * the map is still dirty, which would take back the round's own erases. The one commit is the last,
 * over a clean map, and the loop re-reads the map after it, since its reconcile can disturb it too.
 */
function settleArrival(
  dest: GridState, executor: CommandExecutor, registry: RuleRegistry,
): ValidationError[] {
  return executor.transaction({}, (arrival) => {
    const { act, opts } = arrivalBackOff(dest, executor);
    let taken = false;
    for (let round = 0; round < SETTLE_ROUNDS; round++) {
      const violations = registry.validatePostStroke(dest);
      if (violations.length === 0) {
        if (!taken) return [];
        taken = false;
        arrival.commit();
        continue;
      }
      const gave = executor.transaction({ silent: true }, (taking) => {
        const seen = new Set<string>();
        for (const v of violations) {
          for (const c of v.cells) {
            const key = cellKey(c.x, c.y);
            if (seen.has(key)) continue;
            seen.add(key);
            backOffAt(dest, act, c, opts);
          }
        }
        if (taking.size === 0) return false;
        taking.collapse();
        return true;
      });
      if (!gave) return violations; // nothing left to give
      taken = true;
    }
    return registry.validatePostStroke(dest);
  });
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────

/**
 * What arrived and what did not, read from the two maps rather than tallied as the replay ran.
 *
 * A command that succeeded is not a thing that stands: the post-stroke pass can revert one, the road
 * reconcile can take a coating back, and the repair fixpoint lowers mass before a single command is
 * issued. The states are the only account that cannot drift from the map in front of the user.
 *
 * A cell counts as arrived when the destination holds terrain where the source did. Terrain that
 * arrived a tier lower is terrain that arrived: the loss the report is about is content that could
 * not land at all — a coast that moved, an edge that ran off the map. The cells of plan notes left
 * behind (`lostNotes`) join the marked cells and no count. Each marked cell names its grid.
 */
function countCarried(
  source: GridState,
  dest: GridState,
  offset: MacroCoord,
  lostNotes: readonly MacroCoord[],
): { moved: TransferCounts; dropped: TransferCounts; droppedCells: GridCellRef[] } {
  const terrainAt = carriedTerrain(source);
  const lost = new Map<string, GridCellRef>();
  const key = (grid: GridId, x: number, y: number): string => `${grid}:${cellKey(x, y)}`;
  const loseGround = (x: number, y: number): void => {
    const k = key(TERRAIN_GRID, x, y);
    if (!lost.has(k)) lost.set(k, { x, y, grid: TERRAIN_GRID });
  };
  // A placement cell whose every terrain cell is already lost adds nothing to the marks.
  const lose = (x: number, y: number): void => {
    const k = key(PLACEMENT_GRID, x, y);
    if (lost.has(k) || terrainCellsUnder({ x, y, w: 1, h: 1 }).every((t) => lost.has(key(TERRAIN_GRID, t.x, t.y)))) return;
    lost.set(k, { x, y, grid: PLACEMENT_GRID });
  };
  let movedCells = 0, droppedCells = 0;
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      if (!terrainAt(sx, sy)) continue;
      const dx = sx + offset.x, dy = sy + offset.y;
      if (getCell(dest.cells, dx, dy)?.terrain) movedCells++;
      else { droppedCells++; loseGround(dx, dy); }
    }
  }
  let movedObjects = 0, droppedObjects = 0;
  for (const o of source.objects.values()) {
    if (isLandmark(o)) continue;
    if (dest.objects.has(o.id)) { movedObjects++; continue; }
    droppedObjects++;
    for (const c of carriedFootprint(o, offset)) lose(c.x, c.y);
  }
  for (const c of lostNotes) lose(c.x, c.y);
  return {
    moved: { cells: movedCells, objects: movedObjects },
    dropped: { cells: droppedCells, objects: droppedObjects },
    droppedCells: [...lost.values()],
  };
}
