/**
 * Transfers a build by aligning source and destination plaza centers, clearing the destination's
 * own terrain under the carried build, repairing terrain against the new template, and replaying
 * terrain, corners, then objects through live rules. Paint batches split on refusal and land and
 * build use separate strokes. Work occurs on a detached map; `transfer-map.ts` installs it when
 * complete. Existing cell/object provenance is translated with the content. Nothing here reaches
 * the live editor, so the generation worker runs this module for the carry preview.
 */
import type { CommandExecutor } from '../../core/commands/command-executor';
import { cellKey, getCell, hasLandmark, isBuildableZone, NEIGHBORS4, isLandmarkItem } from '../../core/model/grid-model';
import { isCoating } from '../../core/model/traits';
import { createGridState, templateHasTerrain } from '../../core/model/planet';
import { structuralTop, surfaceElevation, patchSupport } from '../../core/edge-cut/terrain-silhouette';
import { ProvSource } from '../../core/provenance/types';
import {
  CommandType,
  TerrainType,
  type Corners,
  type GridState,
  type MacroCoord,
  type MapTemplate,
  type PaintTerrainCommand,
  type PlacedObject,
  type TerrainCell,
  type TrimCornersCommand,
  type ValidationError,
} from '../../core/model/types';
import { createDefaultRegistry } from '../../rules';
import type { RuleRegistry } from '../../rules/registry';
import { getCatalogItem } from '../../state/catalog';
import { createExecutor } from '../../state/executor';
import { getObjectIndex, objectAt } from '../../state/object-index';
import { footprintCells, getPlacedObjectSize, terrainCellsUnder } from '../../state/object-geometry';
import { planToCommands, repairPlan, type TerrainPlan } from '../../tools/generation/core';
import { movedObject, objectPlacementCommand } from '../../tools/objects';

/** Cells and objects are counted apart, because the report names both. */
export interface TransferCounts {
  cells: number;
  objects: number;
}

/** Round to the macro grid, normalising the negative zero `Math.round` returns for -0.5..0, which
 *  compares unequal to 0. */
const macroRound = (v: number): number => Math.round(v) || 0;

/** The point a planet is anchored at. The plaza is the one landmark every template declares, so it
 *  is what the two maps are laid over each other by; a template without one falls back to its
 *  middle, which is the only other thing two maps of different sizes share. */
function plazaAnchor(t: MapTemplate): { x: number; y: number } {
  const p = t.plaza;
  if (!hasLandmark(p)) return { x: t.width / 2, y: t.height / 2 };
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
}

/** How far everything moves between two planets. */
export function plazaOffset(from: MapTemplate, to: MapTemplate): MacroCoord {
  const a = plazaAnchor(from);
  const b = plazaAnchor(to);
  return { x: macroRound(b.x - a.x), y: macroRound(b.y - a.y) };
}

/** The plaza of the map being left. The destination made its own from its own template, and
 *  V-LOCK-02 would refuse this one anyway. */
const isPlaza = (o: PlacedObject): boolean => isLandmarkItem(o.catalogId);

/**
 * Whether this map holds anything a transfer would carry.
 *
 * THE SAME PREDICATE `countCarried` COUNTS BY, so a caller that skips the transfer for an empty map
 * can never skip one that had something to move. A CELL HOLDING TERRAIN counts however low it sits:
 * a ground-level edge cut is a `None` cell at elevation 0 with corners, which occupies no layer and
 * is invisible to any per-layer tally, and it is exactly the kind of work a silent skip would drop.
 */
export function hasCarriableContent(state: GridState): boolean {
  for (const o of state.objects.values()) if (!isPlaza(o)) return true;
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) if (row[x]?.terrain) return true;
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
  /** Every destination cell that would have held carried terrain or part of a carried object's
   *  footprint and does not, cells off the destination included; each cell once. */
  droppedCells: MacroCoord[];
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
  const offset = plazaOffset(source.template, target);
  const registry = createDefaultRegistry();
  // The destination as `initMap` builds it: the template's own zones, terrain and plaza object.
  const dest = createGridState(target);
  dest.ignoreChunkLoad = source.ignoreChunkLoad;
  clearUnderBuild(source, dest, offset);
  const executor = createExecutor(dest, registry);

  const violations = executor.withSource({ source: ProvSource.Imported, tool: 'transfer' }, (): ValidationError[] => {
    // Silenced for the reason a generation is: a refusal here is an outcome the report counts, not
    // an error to raise per cell.
    const paintable = paintableMask(dest, registry);
    // The land first, as its own stroke; its cuts commit with it.
    executor.transaction({}, (tx) => {
      executor.runSilently(() => {
        replayTerrain(source, dest, executor, registry, offset, paintable);
        replayCorners(source, dest, executor, offset, paintable);
      });
      tx.commit();
    });
    const settled = settleArrival(dest, executor, registry);

    // THE BUILD IS ONLY OFFERED TO LAND THAT STANDS. A stroke laid over an illegal map is judged
    // against the whole map, so the build stroke's own commit would find the land's violations and
    // unwind every object on the way to a map it cannot fix — the loss lands on the content that
    // was never the problem. Ground that will not settle arrives bare, and the report says so.
    if (settled.length > 0) return settled;
    executor.transaction({}, (tx) => {
      executor.runSilently(() => replayObjects(source, dest, executor, offset));
      tx.commit();
    });
    // What the map still says about itself, rather than what a commit said on its way to fixing
    // it: `commitStroke` returns the violations it FOUND and then reverts until they are gone, so
    // its answer describes a map that no longer stands.
    return settleArrival(dest, executor, registry);
  });

  // The work's own history comes along with the work: what the replay dropped stays behind
  // (`keepCell`/`keepObject` read the arrival), and what landed keeps its author.
  if (source.provenance) {
    executor.getProvenanceTracker().adoptTransplant(
      source.provenance, offset,
      (x, y) => !!getCell(dest.cells, x, y)?.terrain,
      (id) => dest.objects.has(id),
    );
  }

  // The notes are the BUILD's (its title, who made it), not the planet's, so they come along. The
  // generation recipe does not: it named a map on another template, and this one no longer replays
  // from it.
  if (source.notes) dest.notes = { ...source.notes };

  const { moved, dropped, droppedCells } = countCarried(source, dest, offset);
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
  return terrainCellsUnder(o.position.x + offset.x, o.position.y + offset.y, w, h);
}

/** Clears the planet's own terrain from every destination cell a source terrain cell lands on and
 *  every terrain cell a carried object rests on. Runs on the fresh scratch state before any
 *  executor or index has read it. */
function clearUnderBuild(source: GridState, dest: GridState, offset: MacroCoord): void {
  if (!templateHasTerrain(dest.template)) return;
  const clear = (x: number, y: number): void => {
    const cell = getCell(dest.cells, x, y);
    if (cell) cell.terrain = null;
  };
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) if (row[sx]?.terrain) clear(sx + offset.x, sy + offset.y);
  }
  for (const o of source.objects.values()) {
    if (isPlaza(o)) continue;
    for (const c of carriedGround(o, offset)) clear(c.x, c.y);
  }
}

// ── terrain ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Where the destination will take terrain at all, asked of the rules rather than re-derived.
 *
 * A one-cell probe answers it: what refuses a paint is the zone, the half-cell bleed onto the
 * up/left neighbours, and an object standing in the way (the plaza) — none of which any later paint
 * changes, so one answer per cell holds for the whole replay. The probe runs after
 * `clearUnderBuild`, so every cell the build lands on is empty ground and the planet's own terrain
 * stands only around it. The mask has to be applied BEFORE the plan is repaired: `repairPlan`
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
      const probe: PaintTerrainCommand = {
        type: CommandType.PaintTerrain, timestamp: 0,
        cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
      };
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
      const t = row[sx]?.terrain;
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
  executor: CommandExecutor,
  registry: RuleRegistry,
  offset: MacroCoord,
  paintable: (x: number, y: number) => boolean,
): void {
  const plan = carriedPlan(source, dest.template, offset, paintable);
  const repaired = repairPlan(plan, dest.template, registry);
  for (const cmd of planToCommands(repaired, null)) applyPaint(executor, cmd);
}

// ── silhouette ───────────────────────────────────────────────────────────────────────────────────

/**
 * The carried edge cuts, once the mass they sit on is standing.
 *
 * A cut is offered only where the destination cell holds exactly what the cut describes — the same
 * block at the same tier, or the empty notch a from-empty fillet needs. A cut over terrain the
 * repair pass lowered describes a silhouette that is not there. What survives that test and still
 * does not hold is dropped by `reconcileCuts` when the stroke commits, the same pass that repairs a
 * cut after any other paint.
 *
 * BEFORE THE OBJECTS: a Γ patch materialises terrain on its cell, so V-PLACE-BLOCK refuses it under
 * anything standing there — and a source map is free to have an object on a filleted cell.
 *
 * THE FROM-EMPTY CUTS TAKE THE PAINT MASK. A cut standing on carried mass is on ground the mask
 * already passed, but a from-empty fillet and a ground-islet cut put terrain on a cell that holds
 * none — and V-ZONE-01 does not read a TrimCorners, so nothing else would stop one landing on a
 * coast the destination refuses everything else on.
 */
function replayCorners(
  source: GridState,
  dest: GridState,
  executor: CommandExecutor,
  offset: MacroCoord,
  paintable: (x: number, y: number) => boolean,
): void {
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      const t = row[sx]?.terrain;
      if (!t?.corners) continue;
      const dx = sx + offset.x, dy = sy + offset.y;
      const cell = getCell(dest.cells, dx, dy);
      if (!cell) continue;
      const now = cell.terrain;
      const corners = [...t.corners] as Corners;
      const cut: TrimCornersCommand = {
        type: CommandType.TrimCorners, timestamp: 0,
        x: dx, y: dy, layer: 'terrain',
        beforeCorners: undefined, afterCorners: corners,
      };
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
 * about to stand on it. Every object keeps its ID: the destination holds nothing but its own plaza,
 * so the source's ids are unique there by construction, and a re-minted id would make two runs of
 * one transfer produce different maps. `movedObject` re-reads the elevation from the destination's
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
    if (isPlaza(o)) continue;
    const item = getCatalogItem(o.catalogId);
    (item && isCoating(item) ? coatings : solids).push(o);
  }
  for (const o of [...solids, ...coatings]) {
    const carried = movedObject(dest, o, o.position.x + offset.x, o.position.y + offset.y);
    // The spread in `movedObject` is shallow, and the two maps must share no mutable member.
    if (o.corners) carried.corners = [...o.corners] as Corners;
    executor.execute(objectPlacementCommand(carried));
  }
}

// ── settling ─────────────────────────────────────────────────────────────────────────────────────

/** Rounds an arrival gets to answer for itself. Each one takes mass or an object off the map, so
 *  the loop is short by construction; the cap is a backstop, not a schedule. */
const SETTLE_ROUNDS = 8;

/** What the flagged cell can give up, cheapest first: its own terrain, the object standing on it,
 *  or — where it holds neither — the terrain beside it that stands above it. */
function backOffAt(dest: GridState, executor: CommandExecutor, c: MacroCoord): boolean {
  const cell = getCell(dest.cells, c.x, c.y);
  const erase = (cells: MacroCoord[]): boolean =>
    executor.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells }).success;

  if (cell?.terrain && erase([c])) return true;

  const obj = objectAt(getObjectIndex(dest), c);
  if (obj && !obj.locked && !isPlaza(obj)) {
    const gone = executor.execute({
      type: CommandType.RemoveObject, timestamp: 0, objectId: obj.id, removedObject: obj,
    }).success;
    if (gone) return true;
  }

  const own = surfaceElevation(cell?.terrain);
  let changed = false;
  for (const [dx, dy] of NEIGHBORS4) {
    const n = getCell(dest.cells, c.x + dx, c.y + dy);
    if (n?.terrain && surfaceElevation(n.terrain) > own && erase([{ x: c.x + dx, y: c.y + dy }])) changed = true;
  }
  return changed;
}

/**
 * Take back whatever the arrived map still flags, and report what it flags after that.
 *
 * A COMMIT IS NOT THE LAST WORD ON THE MAP: `commitStroke` runs its reconcile passes AFTER its own
 * post-stroke validation (for the strokes a tool makes they are legal by construction), and a
 * carried Γ fillet whose wrapping context did not survive the move is dropped there — which lowers
 * what its cell structurally holds, and can leave the block beside it standing on nothing. No stage
 * before the commit can see that coming, so the arrival reads the map once more and answers for it.
 *
 * Decrease-only, exactly as the plan repair is, and for the same reason: every round takes
 * something off the map, so it converges, and it can never invent terrain the visitor did not
 * build.
 *
 * A ROUND IS COLLAPSED, NEVER COMMITTED. `commitStroke` validates the whole map before it folds a
 * stroke, and reverts the stroke it was handed when the map is still dirty — which is the state a
 * round runs IN, by definition. Committing a round would therefore take back the erases the round
 * had just made, leaving the next round facing the same map: the loop would spin to its cap having
 * moved nothing. `collapseHistory` folds the round's commands with no validation of its own, so
 * what a round takes stays taken. The reconcile passes a commit would have run are already run per
 * command by the executor; the ONE commit here is the last one, over a map that has come clean,
 * where validation has nothing to revert — and the loop then re-reads the map, since that commit's
 * own reconcile can disturb it exactly like the ones before it.
 */
function settleArrival(
  dest: GridState, executor: CommandExecutor, registry: RuleRegistry,
): ValidationError[] {
  const start = executor.getUndoStackSize();
  let taken = false;
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const violations = registry.validatePostStroke(dest);
    if (violations.length === 0) {
      if (!taken) return [];
      taken = false;
      executor.commitStroke(start);
      continue;
    }
    const watermark = executor.getUndoStackSize();
    const seen = new Set<string>();
    executor.runSilently(() => {
      for (const v of violations) {
        for (const c of v.cells) {
          const key = cellKey(c.x, c.y);
          if (seen.has(key)) continue;
          seen.add(key);
          backOffAt(dest, executor, c);
        }
      }
    });
    if (executor.getUndoStackSize() === watermark) return violations; // nothing left to give
    executor.collapseHistory(watermark);
    taken = true;
  }
  return registry.validatePostStroke(dest);
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────

/**
 * What arrived and what did not, read from the two maps rather than tallied as the replay ran.
 *
 * A command that succeeded is not a thing that stands: the post-stroke pass can revert one, the road
 * reconcile can take a coating back, and the repair fixpoint lowers mass before a single command is
 * issued. The states are the only account that cannot drift from the map in front of the user.
 *
 * A cell COUNTS AS ARRIVED when the destination holds terrain where the source did. Terrain that
 * arrived a tier lower is terrain that arrived: the loss the report is about is content that could
 * not land at all — a coast that moved, an edge that ran off the map.
 */
function countCarried(
  source: GridState,
  dest: GridState,
  offset: MacroCoord,
): { moved: TransferCounts; dropped: TransferCounts; droppedCells: MacroCoord[] } {
  const lost = new Map<string, MacroCoord>();
  const lose = (x: number, y: number): void => {
    const k = cellKey(x, y);
    if (!lost.has(k)) lost.set(k, { x, y });
  };
  let movedCells = 0, droppedCells = 0;
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      if (!row[sx]?.terrain) continue;
      const dx = sx + offset.x, dy = sy + offset.y;
      if (getCell(dest.cells, dx, dy)?.terrain) movedCells++;
      else { droppedCells++; lose(dx, dy); }
    }
  }
  let movedObjects = 0, droppedObjects = 0;
  for (const o of source.objects.values()) {
    if (isPlaza(o)) continue;
    if (dest.objects.has(o.id)) { movedObjects++; continue; }
    droppedObjects++;
    for (const c of carriedFootprint(o, offset)) lose(c.x, c.y);
  }
  return {
    moved: { cells: movedCells, objects: movedObjects },
    dropped: { cells: droppedCells, objects: droppedObjects },
    droppedCells: [...lost.values()],
  };
}
