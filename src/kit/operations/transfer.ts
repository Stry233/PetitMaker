/**
 * Moving to another planet, and taking the build along.
 *
 * A transfer is PLAZA-ANCHORED and ASSUMPTION-FREE. Every template declares exactly one plaza, so
 * the whole build translates by the difference of the two plaza centres (rounded to the macro grid)
 * and is replayed on the destination template through the live rules. A different SIZE only moves
 * the edges (off-map refuses like a coast), a different COASTLINE is zone data the rules already
 * read, and a moved plaza vanishes into the translation — which is what lets a planet that does not
 * exist yet arrive as one JSON file with no code beside it.
 *
 * THE REPLAY IS THE GENERATOR'S OWN MASS-COMMIT, not a second one. The carried terrain becomes a
 * `TerrainPlan`, `repair.ts:repairPlan` makes it rule-valid against the destination by the same
 * decrease-only fixpoint the generator trusts, and `commit.ts:planToCommands` turns it into the
 * bottom-up cumulative paints the no-floating rule requires. Corners ride behind the mass as their
 * own silhouette-only commands, and objects last of all — solids before coatings, so a road lands on
 * the surface it coats rather than under a house.
 *
 * NOTHING IS REFUSED WHOLE. A paint the destination will not take is split in half and retried, so
 * one coastal cell costs one cell rather than a whole layer, and every object is offered on its own.
 * What any stage refuses is COUNTED AT THE END, from the two states: a repair pass can take back
 * what a command placed, so a tally of refusals would report a map that is not the one standing.
 *
 * A LOSS STAYS WHERE IT HAPPENED, because `commitStroke` resolves a violation by unwinding the
 * stroke FROM THE TOP, one command at a time, until the map is legal again — so in one stroke, a
 * cell of water the destination's coast will not hold is paid for by every object above it in the
 * stroke. Two things hold the loss to the cell it belongs to. The land and the build are SEPARATE
 * STROKES, which bounds any unwind to one kind of content and lets the surface settle before
 * anything is asked to stand on it. And each stroke ARRIVES LEGAL: the plan is certified before a
 * command is issued, and `settleArrival` answers for whatever the commit's own reconcile passes
 * disturb afterwards, so the unwind never starts.
 *
 * THE BUILD HAPPENS ON A DETACHED MAP and is installed once it stands, so a transfer that throws
 * leaves the visitor on the planet they were already on. The provenance ledger lives on the
 * `GridState` (`ProvenanceRecorder`'s constructor parks it there), so it rides along into the live
 * executor, which adopts it. The carried work records as `Imported`: this ledger cannot know who
 * authored what on the planet it came from, and `Imported` is the honest answer for that.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { PLAZA_ID } from '../../core/model/constants';
import { cellKey, getCell, isBuildableZone, NEIGHBORS4 } from '../../core/model/grid-model';
import { isCoating } from '../../core/model/traits';
import { structuralTop, surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { ProvSource } from '../../core/provenance/types';
import {
  CommandType,
  TerrainType,
  type Corners,
  type EditorEvents,
  type GridState,
  type MacroCoord,
  type MapTemplate,
  type PaintTerrainCommand,
  type PlacedObject,
  type TerrainCell,
  type TrimCornersCommand,
  type ValidationError,
} from '../../core/model/types';
import { getMapTemplate } from '../../config/maps';
import { createDefaultRegistry } from '../../rules';
import type { RuleRegistry } from '../../rules/registry';
import { catalogLoadValue, getCatalogItem } from '../../state/catalog';
import { getObjectIndex, objectAt, roadLookup } from '../../state/object-index';
import { makeScratchState, planToCommands, repairPlan, type TerrainPlan } from '../../tools/generation/core';
import { movedObject, objectPlacementCommand } from '../../tools/objects';
import { installLoadedMap, type KitContext } from '../context';
import { forgetGenerationScope } from './generate';
import { newMap } from './map';

/** Cells and objects are counted apart, because the report names both. */
export interface TransferCounts {
  cells: number;
  objects: number;
}

export interface TransferOutcome {
  /** The planet arrived at. The template itself, so a caller can name it without a second lookup. */
  target: MapTemplate;
  /** The macro offset everything carried moved by: the difference of the two plaza centres. */
  offset: MacroCoord;
  /** False = the destination opened empty (the plain new-map path). */
  carried: boolean;
  /** What stands on the destination that stood on the source. */
  moved: TransferCounts;
  /** What the destination would not take. */
  dropped: TransferCounts;
  /** Post-stroke violations that survived the commit. Empty on success. */
  violations: ValidationError[];
}

export interface TransferOptions {
  /** The destination planet: a built-in template id, or the template itself (a planet the built-in
   *  registry does not hold). */
  target: string | MapTemplate;
  /** Default true. False is the plain new-map path — the build is left behind. */
  carry?: boolean;
}

/** Round to the macro grid, normalising the negative zero `Math.round` returns for -0.5..0, which
 *  compares unequal to 0. */
const macroRound = (v: number): number => Math.round(v) || 0;

/** The point a planet is anchored at. The plaza is the one landmark every template declares, so it
 *  is what the two maps are laid over each other by; a template without one falls back to its
 *  middle, which is the only other thing two maps of different sizes share. */
function plazaAnchor(t: MapTemplate): { x: number; y: number } {
  const p = t.plaza;
  if (!p || p.width === 0 || p.height === 0) return { x: t.width / 2, y: t.height / 2 };
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
}

/** How far everything moves between two planets. */
export function plazaOffset(from: MapTemplate, to: MapTemplate): MacroCoord {
  const a = plazaAnchor(from);
  const b = plazaAnchor(to);
  return { x: macroRound(b.x - a.x), y: macroRound(b.y - a.y) };
}

const resolveTarget = (target: string | MapTemplate): MapTemplate =>
  typeof target === 'string' ? getMapTemplate(target) : target;

/** The plaza of the map being left. The destination made its own from its own template, and
 *  V-LOCK-02 would refuse this one anyway. */
const isPlaza = (o: PlacedObject): boolean => o.id === PLAZA_ID || o.catalogId === PLAZA_ID;

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

/**
 * Change planet, carrying this island's build to the new one.
 *
 * History resets exactly as it does for any other template switch: the destination arrives under a
 * fresh executor, so a transfer is not undoable (the modal that offers it carries that warning).
 */
export function transferMap(kit: KitContext, opts: TransferOptions): TransferOutcome {
  const target = resolveTarget(opts.target);
  const source = kit.state;
  const offset = plazaOffset(source.template, target);

  if (opts.carry === false) {
    newMap(target);
    return {
      target, offset, carried: false,
      moved: { cells: 0, objects: 0 },
      dropped: { cells: 0, objects: 0 },
      violations: [],
    };
  }

  const registry = createDefaultRegistry();
  // The destination as `initMap` builds it: the template's own zones, its own plaza object, no
  // terrain. Built detached — nothing is live until the whole arrival stands.
  const dest = makeScratchState(target);
  const executor = new CommandExecutor(
    dest, new EventBus<EditorEvents>(), registry, roadLookup(dest), catalogLoadValue,
  );

  executor.pushSource({ source: ProvSource.Imported, tool: 'transfer' });
  let violations: ValidationError[];
  try {
    // Silenced for the reason a generation is: a refusal here is an outcome the report counts, not
    // an error to raise per cell.
    const paintable = paintableMask(dest, registry);
    // The land first, as its own stroke; its cuts commit with it.
    const land = executor.getUndoStackSize();
    executor.runSilently(() => {
      replayTerrain(source, dest, executor, registry, offset, paintable);
      replayCorners(source, dest, executor, offset, paintable);
    });
    executor.commitStrokeGroup(land);
    violations = settleArrival(dest, executor, registry);

    // THE BUILD IS ONLY OFFERED TO LAND THAT STANDS. A stroke laid over an illegal map is judged
    // against the whole map, so the build stroke's own commit would find the land's violations and
    // unwind every object on the way to a map it cannot fix — the loss lands on the content that
    // was never the problem. Ground that will not settle arrives bare, and the report says so.
    if (violations.length === 0) {
      const build = executor.getUndoStackSize();
      executor.runSilently(() => replayObjects(source, dest, executor, offset));
      executor.commitStrokeGroup(build);
      // What the map still says about itself, rather than what a commit said on its way to fixing
      // it: `commitStroke` returns the violations it FOUND and then reverts until they are gone, so
      // its answer describes a map that no longer stands.
      violations = settleArrival(dest, executor, registry);
    }
  } finally {
    executor.popSource();
  }

  // The notes are the BUILD's (its title, who made it), not the planet's, so they come along. The
  // generation recipe does not: it named a map on another template, and this one no longer replays
  // from it.
  if (source.notes) dest.notes = { ...source.notes };

  installLoadedMap(dest, registry);
  forgetGenerationScope();

  const { moved, dropped } = countCarried(source, dest, offset);
  return { target, offset, carried: true, moved, dropped, violations };
}

// ── terrain ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Where the destination will take terrain at all, asked of the rules rather than re-derived.
 *
 * A one-cell probe answers it: what refuses a paint on empty ground is the zone, the half-cell bleed
 * onto the up/left neighbours, and an object standing in the way (the plaza) — none of which any
 * later paint changes, so one answer per cell holds for the whole replay. The mask has to be applied
 * BEFORE the plan is repaired: `repairPlan` certifies the plan as it would stand, and a plan holding
 * cells the map will refuse certifies a map that never arrives, leaving the real one a support cell
 * short and the whole stroke reverted at commit.
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
 *  cosmetic and is replayed as a corner), nothing for a `None` island cut. −1 = no mass. */
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
 * already passed, but a from-empty fillet and a ground-island cut put terrain on a cell that holds
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
        const base = t.patchBase ?? t.elevation - 1;
        const standing = base < 1
          ? now === null && paintable(dx, dy)
          : !!now && !now.patchOnly && now.type === t.type && now.elevation === base;
        if (!standing) continue;
        executor.execute({
          ...cut, patchOnly: true, terrainType: t.type, elevation: t.elevation, patchBase: base,
        });
      } else if (t.type === TerrainType.None) {
        // The island cut carries no mass: anything standing here is not what it rounds.
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
      executor.commitStrokeGroup(start);
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
): { moved: TransferCounts; dropped: TransferCounts } {
  let movedCells = 0, droppedCells = 0;
  for (let sy = 0; sy < source.template.height; sy++) {
    const row = source.cells[sy];
    if (!row) continue;
    for (let sx = 0; sx < row.length; sx++) {
      if (!row[sx]?.terrain) continue;
      if (getCell(dest.cells, sx + offset.x, sy + offset.y)?.terrain) movedCells++;
      else droppedCells++;
    }
  }
  let movedObjects = 0, droppedObjects = 0;
  for (const o of source.objects.values()) {
    if (isPlaza(o)) continue;
    if (dest.objects.has(o.id)) movedObjects++;
    else droppedObjects++;
  }
  return {
    moved: { cells: movedCells, objects: movedObjects },
    dropped: { cells: droppedCells, objects: droppedObjects },
  };
}
