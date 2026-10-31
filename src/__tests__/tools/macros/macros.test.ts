/**
 * The macro contract. A macro is exactly one undo entry, since rerolling a proposal is `undo()`
 * then the next seed; the undo tests demand the grid back byte for byte.
 */
import { placeObjectCommand } from '../../../core/model/command-build';
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules';
import type { RuleRegistry } from '../../../rules/registry';
import type { GridState, MacroCoord, PlacedObject, PostStrokeRule } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { objectRect } from '../../../state/object-geometry';
import { roadLookup } from '../../../state/object-index';
import { generateObjectId } from '../../../core/model/object-id';
import { categoryOf } from '../../../state/catalog';
import { applyMacro } from '../../../tools/macros';
import { FLAT_TOP } from '../../../tools/macros/terrain/terrace';
import { clearGenerated } from '../../../editor/operations';
import type { EditContext } from '../../../core/commands/edit-context';
import { makeState, makeExecutor } from '../../_support/map-state';
import { ItemCategory } from '../../../config/catalog/categories';

function setup(w = 32, h = 32): { kit: EditContext; state: GridState; exec: CommandExecutor; registry: RuleRegistry } {
  const state = makeState(w, h);
  const registry = createDefaultRegistry();
  const exec = makeExecutor(state, registry);
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

/** The same picture without object ids, which differ between runs; both the Map keys and the
 *  objects' own `id` fields are left out. */
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

type Rect = { x: number; y: number; w: number; h: number };

/** The cells of the ring one step outside a footprint: where a road serving it can lie. */
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

function place(kit: EditContext, catalogId: string, x: number, y: number): boolean {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  return kit.executor.execute(placeObjectCommand(obj)).success;
}

describe('applyMacro', () => {
  it('plants a patch around the aim point', () => {
    const { kit, state } = setup();
    const outcome = applyMacro(kit, 'patch-tree', { seed: 7, at: { x: 16, y: 16 }, radius: 10 });
    expect(outcome.changes).toBeGreaterThan(0);
    expect(outcome.reason).toBeUndefined();
    expect(state.objects.size).toBe(outcome.changes);
  });

  it('a patch is one undo entry', () => {
    const { kit, exec, state } = setup();
    const before = gridSnapshot(state);
    const depth = exec.historyDepth();

    expect(applyMacro(kit, 'patch-tree', { seed: 3, at: { x: 16, y: 16 }, radius: 10 }).changes).toBeGreaterThan(0);
    expect(exec.historyDepth()).toBe(depth + 1);

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

  // Open ground around a central hill is a ring whose centroid sits on the hilltop; the router seeds
  // its network at the hub, so a hub left there would strand every route.
  it('connects buildings around relief in the middle of the map', () => {
    const { kit, state } = setup(40, 40);
    applyMacro(kit, 'raise', { seed: 1, at: { x: 20, y: 20 }, radius: 7, stage: 3 });
    expect(place(kit, 'building-myhouse', 8, 8)).toBe(true);
    expect(place(kit, 'building-stall', 8, 30)).toBe(true);
    const [a, b] = [...state.objects.values()].map((o) => objectRect(o));

    const outcome = applyMacro(kit, 'roads', { seed: 23 });
    expect(outcome.reason).toBeUndefined();
    expect(outcome.changes).toBeGreaterThan(0);

    // One pavement, not two stubs.
    expect(touchesRect(roadsFrom(state, a!), b!)).toBe(true);
  });

  it('a road network is one undo entry', () => {
    const { kit, exec, state } = setup();
    place(kit, 'building-myhouse', 4, 4);
    place(kit, 'building-stall', 24, 24);

    const before = gridSnapshot(state);
    const depth = exec.historyDepth();

    expect(applyMacro(kit, 'roads', { seed: 5 }).changes).toBeGreaterThan(0);
    expect(exec.historyDepth()).toBe(depth + 1);

    exec.undo();
    expect(gridSnapshot(state)).toBe(before);
  });

  it('the same seed builds the same thing', () => {
    const a = setup(), b = setup();
    applyMacro(a.kit, 'patch-tree', { seed: 99, at: { x: 16, y: 16 }, radius: 8 });
    applyMacro(b.kit, 'patch-tree', { seed: 99, at: { x: 16, y: 16 }, radius: 8 });
    const shape = (s: GridState) => [...s.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');
    expect(shape(a.state)).toBe(shape(b.state));
  });

  // `commitStroke` reverts only until the state is legal, so part of a run can stand under one undo
  // entry, and `changes` counts that part so the shell knows to undo it.
  it('reports what survived a partial post-stroke revert', () => {
    const { kit, exec, state, registry } = setup();
    const cap: PostStrokeRule = {
      id: 'V-TEST-CAP',
      phase: 'post-stroke',
      validate: (s) => (s.objects.size > 5
        ? [{ ruleId: 'V-TEST-CAP', message: 'more than five objects', cells: [], grid: 'object' }]
        : []),
    };
    registry.register(cap);
    const depth = exec.historyDepth();

    const outcome = applyMacro(kit, 'patch-tree', { seed: 7, at: { x: 16, y: 16 }, radius: 10 });
    expect(state.objects.size).toBe(5);
    expect(exec.historyDepth()).toBe(depth + 1);
    expect(outcome.changes).toBe(5);
    expect(outcome.reason).toEqual(expect.any(String));

    exec.undo();
    expect(state.objects.size).toBe(0);
  });

  // A hand placement in the same ground survives the Clear.
  it('[GEN-10] attributes what it laid to the generator, and Clear takes it back', () => {
    const { kit, state } = setup();
    place(kit, 'building-myhouse', 2, 2);
    applyMacro(kit, 'patch-tree', { seed: 7, at: { x: 20, y: 20 }, radius: 10 });
    expect(state.provenance!.session.proceduralRuns).toBeGreaterThan(0);
    expect(state.objects.size).toBeGreaterThan(1);

    clearGenerated(kit, { region: null });
    expect([...state.objects.values()].map((o) => o.catalogId)).toEqual(['building-myhouse']);
  });

  it('reports an empty run as data rather than throwing', () => {
    const { kit, exec } = setup();
    const depth = exec.historyDepth();

    // No aim point, so there is nowhere to plant.
    const aimless = applyMacro(kit, 'patch-tree', { seed: 1 });
    expect(aimless).toEqual({ changes: 0, reason: expect.any(String) });

    // An empty map has nothing to connect.
    const nothing = applyMacro(kit, 'roads', { seed: 1 });
    expect(nothing.changes).toBe(0);
    expect(nothing.reason).toEqual(expect.any(String));

    expect(exec.historyDepth()).toBe(depth);
  });

  // A rise is nested terraces over one flat top: a ray from the summit never climbs, and every level
  // above the flat top is narrower than it.
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
    // `changes` counts cells for the terrain macros; they lay no objects at all.
    expect(state.objects.size).toBe(0);
    expect(outcome.changes).toBe(raisedCells(state));
  });

  it('a raise is one undo entry', () => {
    const { kit, exec, state } = setup(40, 40);
    seaBorder(state);
    applyMacro(kit, 'raise', { seed: 1, at: { x: 20, y: 20 }, radius: 10, stage: 3 });

    const before = gridSnapshot(state);
    const depth = exec.historyDepth();
    const outcome = applyMacro(kit, 'raise', { seed: 4, at: { x: 12, y: 30 }, radius: 8 });
    expect(outcome.changes).toBeGreaterThan(0);
    expect(exec.historyDepth()).toBe(depth + 1);

    exec.undo();
    expect(gridSnapshot(state)).toBe(before);
  });

  it('reports a rise with no room for it rather than throwing', () => {
    const { kit, state, exec } = setup();
    for (const row of state.cells) for (const cell of row) cell.zone = CellZone.Void;
    const depth = exec.historyDepth();

    // A rise over ground that refuses it reports a peak of 0.
    expect(applyMacro(kit, 'raise', { seed: 1, at: { x: 16, y: 16 }, radius: 6 }))
      .toEqual({ changes: 0, reason: expect.any(String), peak: 0 });
    expect(applyMacro(kit, 'raise', { seed: 1, at: { x: 999, y: 999 }, radius: 6 })).toEqual({ changes: 0, reason: expect.any(String) });
    expect(applyMacro(kit, 'raise', { seed: 1 })).toEqual({ changes: 0, reason: expect.any(String) });
    expect(exec.historyDepth()).toBe(depth);
  });

  // One fixture for all four: relief to one side, two buildings on the flat, and the aim point on
  // the hill for the three that take one.
  it.each(['raise', 'patch-tree', 'patch-flora', 'roads'] as const)('builds the same %s twice at one seed', (id) => {
    const run = (): { grid: string; changes: number } => {
      const { kit, state } = setup(40, 40);
      seaBorder(state);
      applyMacro(kit, 'raise', { seed: 1, at: { x: 29, y: 11 }, radius: 7, stage: 3 });
      place(kit, 'building-myhouse', 8, 8);
      place(kit, 'building-stall', 8, 30);
      const { changes } = applyMacro(kit, id, { seed: 23, at: { x: 29, y: 11 }, radius: 8 });
      return { grid: shapeSnapshot(state), changes };
    };
    const a = run(), b = run();
    expect(a.changes).toBeGreaterThan(0); // else two empty runs would compare equal
    expect(a.grid).toBe(b.grid);
    expect(b.changes).toBe(a.changes);
  });
});
