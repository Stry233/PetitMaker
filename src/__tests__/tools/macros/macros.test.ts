/**
 * The macro contract, and the one property the shell's proposal flow is built on: a macro is
 * EXACTLY ONE undo entry. Rerolling a proposal is `undo()` then applying the next seed, so a macro
 * that landed as two entries would leave half of itself on the map and every later reroll would
 * stack on that half. Each test below applies, undoes once, and demands the grid back byte for byte.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import type { RuleRegistry } from '../../../rules/registry';
import { CellZone, ItemCategory, TerrainType, type EditorEvents, type GridState, type MacroCoord, type PlacedObject, type PostStrokeRule } from '../../../core/model/types';
import { NEIGHBORS4 } from '../../../core/model/grid-model';
import { objectRect } from '../../../state/object-geometry';
import { roadLookup } from '../../../state/object-index';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { categoryOf } from '../../../state/catalog';
import { applyMacro } from '../../../tools/macros';
import { FLAT_TOP } from '../../../tools/macros/terrace';
import { clearGenerated } from '../../../kit/operations';
import type { KitContext } from '../../../kit/context';
import { makeState } from '../../rules/_helpers';

function setup(w = 32, h = 32): { kit: KitContext; state: GridState; exec: CommandExecutor; registry: RuleRegistry } {
  const state = makeState(w, h);
  const registry = createDefaultRegistry();
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
  return { kit: { state, executor: exec, registry: exec.getRegistry() }, state, exec, registry };
}

/** Terrain and objects, ids included: what an undo has to put back. Object order follows the Map's
 *  insertion order, which an undo of a group restores along with the entries. */
function gridSnapshot(state: GridState): string {
  return JSON.stringify({ cells: state.cells, objects: [...state.objects.entries()] });
}

/** A sea margin around the map, so a course has a coast to reach. */
function seaBorder(state: GridState, margin = 3): void {
  const { width, height } = state.template;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < margin || y < margin || x >= width - margin || y >= height - margin) state.cells[y]![x]!.zone = CellZone.Void;
  }
}

/** The same picture with object IDS left out, for comparing two runs that minted their own. Ids
 *  appear TWICE in a `gridSnapshot` — as the Map key and as the object's own field — so a text
 *  substitution over the id field alone leaves the keys, and a comparison built on it can only pass
 *  while the runs place nothing at all. */
function shapeSnapshot(state: GridState): string {
  const withoutId = [...state.objects.values()].map(({ id: _id, ...rest }) => rest);
  return JSON.stringify({ cells: state.cells, objects: withoutId });
}

function surface(state: GridState, x: number, y: number): number {
  return state.cells[y]?.[x]?.terrain?.elevation ?? 0;
}

function raisedCells(state: GridState): number {
  let n = 0;
  for (const row of state.cells) for (const cell of row) if (cell.terrain) n++;
  return n;
}

function waterCells(state: GridState): { x: number; y: number; elevation: number }[] {
  const out: { x: number; y: number; elevation: number }[] = [];
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell.terrain?.type === TerrainType.Water) out.push({ x, y, elevation: cell.terrain.elevation });
  }));
  return out;
}

function distanceToShore(state: GridState, c: { x: number; y: number }): number {
  let best = Infinity;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const cell = state.cells[c.y + dy]?.[c.x + dx];
    if (cell && cell.zone !== CellZone.Grass) best = Math.min(best, Math.abs(dx) + Math.abs(dy));
  }
  return best;
}

type Rect = { x: number; y: number; w: number; h: number };

/** The cells of the ring one step outside a footprint — where a road serving it can lie. */
function doorRing(rect: Rect): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = Math.floor(rect.y) - 1; y <= rect.y + rect.h; y++) {
    for (let x = Math.floor(rect.x) - 1; x <= rect.x + rect.w; x++) out.push({ x, y });
  }
  return out;
}

/** The road cells 4-connected to a road on `rect`'s door ring: one contiguous pavement. */
function roadsFrom(state: GridState, rect: Rect): Set<string> {
  const roads = roadLookup(state);
  const seen = new Set<string>(), queue: MacroCoord[] = [];
  const visit = (c: MacroCoord): void => { const k = `${c.x},${c.y}`; if (roads(c.x, c.y) && !seen.has(k)) { seen.add(k); queue.push(c); } };
  doorRing(rect).forEach(visit);
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i]!;
    for (const [dx, dy] of NEIGHBORS4) visit({ x: x + dx, y: y + dy });
  }
  return seen;
}

function touchesRect(cells: Set<string>, rect: Rect): boolean {
  return doorRing(rect).some((c) => cells.has(`${c.x},${c.y}`));
}

function place(kit: KitContext, catalogId: string, x: number, y: number): boolean {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  return kit.executor.execute(objectPlacementCommand(obj)).success;
}

describe('applyMacro', () => {
  it('plants a patch around the aim point', () => {
    const { kit, state } = setup();
    const outcome = applyMacro(kit, 'patch-tree', { seed: 7, at: { x: 16, y: 16 }, radius: 10, density: 0.9 });
    expect(outcome.changes).toBeGreaterThan(0);
    expect(outcome.reason).toBeUndefined();
    expect(state.objects.size).toBe(outcome.changes);
  });

  it('a patch is one undo entry', () => {
    const { kit, exec, state } = setup();
    const before = gridSnapshot(state);
    const depth = exec.getUndoStackSize();

    expect(applyMacro(kit, 'patch-tree', { seed: 3, at: { x: 16, y: 16 }, radius: 10, density: 0.9 }).changes).toBeGreaterThan(0);
    expect(exec.getUndoStackSize()).toBe(depth + 1);

    exec.undo();
    expect(gridSnapshot(state)).toBe(before);
  });

  it('lays a road network between what is already standing', () => {
    const { kit, state } = setup();
    expect(place(kit, 'building-myhouse', 4, 4)).toBe(true);
    expect(place(kit, 'building-stall', 24, 24)).toBe(true);

    const outcome = applyMacro(kit, 'roads', { seed: 5 });
    expect(outcome.changes).toBeGreaterThan(0);
    expect([...state.objects.values()].some((o) => categoryOf(o) === ItemCategory.Road)).toBe(true);
  });

  // Relief in the middle of the map is the hard shape: the open ground wrapping a hill is
  // a RING, whose centroid sits on the hilltop rather than in it. The router seeds its whole network
  // on the hub node, so a hub left on that summit strands every route on a cell nothing can reach and
  // the run lays nothing at all — on the one macro the shell offers a reroll for.
  it('connects buildings around relief in the middle of the map', () => {
    const { kit, state } = setup(40, 40);
    applyMacro(kit, 'raise', { seed: 1, at: { x: 20, y: 20 }, radius: 7, stage: 3 });
    expect(place(kit, 'building-myhouse', 8, 8)).toBe(true);
    expect(place(kit, 'building-stall', 8, 30)).toBe(true);
    const [a, b] = [...state.objects.values()].map((o) => objectRect(o));

    const outcome = applyMacro(kit, 'roads', { seed: 23 });
    expect(outcome.reason).toBeUndefined();
    expect(outcome.changes).toBeGreaterThan(0);

    // One pavement, not two stubs: the roads reachable from one doorstep have to reach the other's.
    expect(touchesRect(roadsFrom(state, a!), b!)).toBe(true);
  });

  it('a road network is one undo entry', () => {
    const { kit, exec, state } = setup();
    place(kit, 'building-myhouse', 4, 4);
    place(kit, 'building-stall', 24, 24);

    const before = gridSnapshot(state);
    const depth = exec.getUndoStackSize();

    expect(applyMacro(kit, 'roads', { seed: 5 }).changes).toBeGreaterThan(0);
    expect(exec.getUndoStackSize()).toBe(depth + 1);

    exec.undo();
    expect(gridSnapshot(state)).toBe(before);
  });

  it('the same seed builds the same thing', () => {
    const a = setup(), b = setup();
    applyMacro(a.kit, 'patch-tree', { seed: 99, at: { x: 16, y: 16 }, radius: 8, density: 0.7 });
    applyMacro(b.kit, 'patch-tree', { seed: 99, at: { x: 16, y: 16 }, radius: 8, density: 0.7 });
    const shape = (s: GridState) => [...s.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');
    expect(shape(a.state)).toBe(shape(b.state));
  });

  it('plants only the categories it was given', () => {
    const { kit, state } = setup();
    applyMacro(kit, 'patch-tree', { seed: 11, at: { x: 16, y: 16 }, radius: 12, density: 1, categories: [ItemCategory.Flora] });
    expect(state.objects.size).toBeGreaterThan(0);
    expect([...state.objects.values()].every((o) => categoryOf(o) === ItemCategory.Flora)).toBe(true);
  });

  // An empty list is what a caller sends when its category picker came out empty, so it is answered
  // as the refusal it reads as rather than run as an unrestricted planting.
  it('refuses an empty category list instead of planting everything', () => {
    const { kit, exec, state } = setup();
    const depth = exec.getUndoStackSize();

    const outcome = applyMacro(kit, 'patch-tree', { seed: 11, at: { x: 16, y: 16 }, radius: 12, density: 1, categories: [] });
    expect(outcome).toEqual({ changes: 0, reason: expect.any(String) });
    expect(state.objects.size).toBe(0);
    expect(exec.getUndoStackSize()).toBe(depth);
  });

  // `commitStroke` auto-reverts only until the state is legal, so a post-stroke violation can stop
  // mid-revert and leave part of the run standing under one undo entry. `changes` has to report
  // what survived: a shell told "nothing happened" has no reason to undo before its next apply.
  it('reports what survived a partial post-stroke revert', () => {
    const { kit, exec, state, registry } = setup();
    const cap: PostStrokeRule = {
      id: 'V-TEST-CAP',
      phase: 'post-stroke',
      validate: (s) => (s.objects.size > 5
        ? [{ ruleId: 'V-TEST-CAP', message: 'more than five objects', cells: [], severity: 'error' as const }]
        : []),
    };
    registry.register(cap);
    const depth = exec.getUndoStackSize();

    const outcome = applyMacro(kit, 'patch-tree', { seed: 7, at: { x: 16, y: 16 }, radius: 10, density: 0.9 });
    expect(state.objects.size).toBe(5);
    expect(exec.getUndoStackSize()).toBe(depth + 1);
    expect(outcome.changes).toBe(5);
    expect(outcome.reason).toEqual(expect.any(String));

    // Still exactly one entry, so the caller's undo takes the residue back whole.
    exec.undo();
    expect(state.objects.size).toBe(0);
  });

  // A macro is the generator's machinery invoked at a point, so Clear has to take it back the same
  // way it takes back a run, while a hand placement inside the same ground survives.
  it('attributes what it laid to the generator, and Clear takes it back', () => {
    const { kit, state } = setup();
    place(kit, 'building-myhouse', 2, 2);
    applyMacro(kit, 'patch-tree', { seed: 7, at: { x: 20, y: 20 }, radius: 10, density: 0.9 });
    expect(kit.executor.getProvenanceSummary().counts.proceduralRuns).toBeGreaterThan(0);
    expect(state.objects.size).toBeGreaterThan(1);

    clearGenerated(kit, { region: null });
    expect([...state.objects.values()].map((o) => o.catalogId)).toEqual(['building-myhouse']);
  });

  it('reports an empty run as data rather than throwing', () => {
    const { kit, exec } = setup();
    const depth = exec.getUndoStackSize();

    // No aim point, so there is nowhere to plant.
    const aimless = applyMacro(kit, 'patch-tree', { seed: 1 });
    expect(aimless).toEqual({ changes: 0, reason: expect.any(String) });

    // An empty map has nothing to connect.
    const nothing = applyMacro(kit, 'roads', { seed: 1 });
    expect(nothing.changes).toBe(0);
    expect(nothing.reason).toEqual(expect.any(String));

    expect(exec.getUndoStackSize()).toBe(depth);
  });

  // A rise is nested terraces: one flat top over the whole footprint, and a core one tier higher for
  // each rung above it. So a ray from the summit falls to the rim without ever climbing back, and the
  // flat top is the widest level on the map, every terrace above it standing inside that one.
  it('raises a terraced mound that steps down to its rim', () => {
    const { kit, state } = setup();
    const outcome = applyMacro(kit, 'raise', { seed: 1, at: { x: 16, y: 16 }, radius: 7, stage: 5, steepness: 'steep' });
    expect(outcome.changes).toBeGreaterThan(0);
    const ray = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => surface(state, 16, 16 + d));
    expect(ray[0]).toBeGreaterThan(FLAT_TOP);
    expect(ray[7]).toBeLessThan(ray[0]!);
    for (let i = 1; i < ray.length; i++) expect(ray[i]).toBeLessThanOrEqual(ray[i - 1]!);

    const count = new Map<number, number>();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const e = surface(state, x, y);
      if (e > 0) count.set(e, (count.get(e) ?? 0) + 1);
    }
    for (const [level, cells] of count) {
      if (level > FLAT_TOP) expect(cells, `level ${level} is wider than the flat top`).toBeLessThan(count.get(FLAT_TOP)!);
    }
    // `changes` counts CELLS for the terrain macros; they lay no objects at all.
    expect(state.objects.size).toBe(0);
    expect(outcome.changes).toBe(raisedCells(state));
  });

  it('carves a stream from the hillside into the sea', () => {
    const { kit, state, exec } = setup(40, 40);
    seaBorder(state);
    applyMacro(kit, 'raise', { seed: 1, at: { x: 20, y: 20 }, radius: 10, stage: 3 });

    const outcome = applyMacro(kit, 'stream', { seed: 4, at: { x: 20, y: 20 }, radius: 8 });
    expect(outcome.changes).toBeGreaterThan(0);

    const water = waterCells(state);
    expect(water.some((w) => w.elevation > 0)).toBe(true);          // a fall on the hillside
    expect(water.some((w) => w.elevation === 0)).toBe(true);        // and the river it becomes
    // The course reached the coast. Within two cells rather than touching it: a painted block
    // renders half a tile up and left, so V-ZONE-01 reserves the last strip of grass along a north
    // or west shore and no brush of any kind can reach it.
    expect(water.some((w) => w.elevation === 0 && distanceToShore(state, w) <= 2)).toBe(true);
    expect(exec.getRegistry().validatePostStroke(state)).toEqual([]);
  });

  // Water is the one thing a macro must never leave broken, so the failure is total: a course that
  // cannot reach the sea takes back every cell it tried, rather than leaving a puddle on a slope.
  it('leaves no water behind when the course cannot reach the sea', () => {
    const { kit, state, exec } = setup(40, 40);
    applyMacro(kit, 'raise', { seed: 1, at: { x: 20, y: 20 }, radius: 10, stage: 3 });
    const before = gridSnapshot(state);
    const depth = exec.getUndoStackSize();

    // No coast anywhere on this map, so nothing the stream builds can be grounded.
    const outcome = applyMacro(kit, 'stream', { seed: 4, at: { x: 20, y: 20 }, radius: 8 });
    expect(outcome).toEqual({ changes: 0, reason: expect.any(String) });
    expect(waterCells(state)).toEqual([]);
    expect(gridSnapshot(state)).toBe(before);
    expect(exec.getUndoStackSize()).toBe(depth);
  });

  it.each(['raise', 'stream'] as const)('a %s is one undo entry', (id) => {
    const { kit, exec, state } = setup(40, 40);
    seaBorder(state);
    applyMacro(kit, 'raise', { seed: 1, at: { x: 20, y: 20 }, radius: 10, stage: 3 });

    const before = gridSnapshot(state);
    const depth = exec.getUndoStackSize();
    const outcome = applyMacro(kit, id, { seed: 4, at: id === 'stream' ? { x: 20, y: 20 } : { x: 12, y: 30 }, radius: 8, density: 0.5 });
    expect(outcome.changes).toBeGreaterThan(0);
    expect(exec.getUndoStackSize()).toBe(depth + 1);

    exec.undo();
    expect(gridSnapshot(state)).toBe(before);
  });

  it('reports a rise with no room for it rather than throwing', () => {
    const { kit, state, exec } = setup();
    for (const row of state.cells) for (const cell of row) cell.zone = CellZone.Void;
    const depth = exec.getUndoStackSize();

    // A rise over ground that refuses it still reports the tier that ground carries, which is none.
    expect(applyMacro(kit, 'raise', { seed: 1, at: { x: 16, y: 16 }, radius: 6 }))
      .toEqual({ changes: 0, reason: expect.any(String), peak: 0 });
    expect(applyMacro(kit, 'raise', { seed: 1, at: { x: 999, y: 999 }, radius: 6 })).toEqual({ changes: 0, reason: expect.any(String) });
    expect(applyMacro(kit, 'raise', { seed: 1 })).toEqual({ changes: 0, reason: expect.any(String) });
    expect(exec.getUndoStackSize()).toBe(depth);
  });

  // `roads` is the macro the shell rerolls, so it is the one whose seed most needs pinning. The
  // fixture is shared, so it has to be one all five can work in: relief off to one side (the
  // router lays nothing when the map's largest open region has a hill sitting in the middle of it)
  // with two buildings on the flat, and the aim point on the hill for the four that take one.
  it.each(['raise', 'stream', 'patch-tree', 'patch-flora', 'roads'] as const)('builds the same %s twice at one seed', (id) => {
    const run = (): { grid: string; changes: number } => {
      const { kit, state } = setup(40, 40);
      seaBorder(state);
      applyMacro(kit, 'raise', { seed: 1, at: { x: 29, y: 11 }, radius: 7, stage: 3 });
      place(kit, 'building-myhouse', 8, 8);
      place(kit, 'building-stall', 8, 30);
      const { changes } = applyMacro(kit, id, { seed: 23, at: { x: 29, y: 11 }, radius: 8, density: 0.5 });
      return { grid: shapeSnapshot(state), changes };
    };
    const a = run(), b = run();
    expect(a.changes).toBeGreaterThan(0);   // else two empty runs would compare equal
    expect(a.grid).toBe(b.grid);
    expect(b.changes).toBe(a.changes);
  });
});
