/**
 * A painted region is a boundary the agent cannot cross, on EVERY write path. `runStroke` checks
 * each command as it applies; `runStrokeBody` — the callback variant `build_road`/`scatter_objects`/
 * `rotate_object` and the four director tools use — reads the commands back off the executor once
 * its body settles and checks the same list against the same test. One rule, two entry points.
 *
 * The check reads commands AS APPLIED — the bridge and ramp traits snap position during
 * validation, so where a command finally lands is only knowable once it has run.
 *
 * `build_road_network` and `frame_crossing` plan from a whole-map terrain analysis, so for them the
 * region is also an INPUT: confined to it, they design inside it instead of designing island-wide
 * and being refused. Their cases below assert the containment rather than a refusal.
 */
import { describe, it, expect } from 'vitest';
import { commandCells, runStroke } from '../../agent/tools/tools-common';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CellZone, CommandType, ItemCategory, TerrainType } from '../../core/model/types';
import type { Command, EditorEvents, GridState, MacroCoord, PlacedObject } from '../../core/model/types';
import { executeToolCall, type AgentToolDeps } from '../../agent/tools';
import { getCatalogByCategory } from '../../state/catalog';
import { makeState, setTerrain, setZone } from '../rules/_helpers';
import { roadLookup } from '../../state/object-index';

/** A 4x4 region in the top-left of a 12x12 map. */
const REGION: MacroCoord[] = [];
for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) REGION.push({ x, y });

function world(region: MacroCoord[], w = 12, h = 12) {
  const state = makeState(w, h);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const deps = {
    getState: () => state, getExecutor: () => executor, getRegion: () => region,
  } as unknown as AgentToolDeps;
  return { state, executor, deps };
}

const paint = (...cells: MacroCoord[]): Command => ({
  type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: TerrainType.Mountain, elevation: 1,
});

describe('with no region painted', () => {
  it('lets the agent work anywhere', () => {
    const { state, deps } = world([]);
    const r = runStroke(deps, [paint({ x: 9, y: 9 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(false);
    expect(state.cells[9]![9]!.terrain).not.toBeNull();
  });
});

describe('with a region painted', () => {
  it('applies an edit wholly inside it', () => {
    const { state, deps } = world(REGION);
    const r = runStroke(deps, [paint({ x: 2, y: 2 }, { x: 3, y: 3 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(false);
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
  });

  it('refuses an edit that reaches outside, and applies NOTHING', () => {
    // All-or-nothing on purpose: a half-applied edit makes undo restore a state the user never saw.
    const { state, executor, deps } = world(REGION);
    const before = executor.getUndoStackSize();
    const r = runStroke(deps, [paint({ x: 2, y: 2 }, { x: 9, y: 9 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(true);
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(state.cells[9]![9]!.terrain).toBeNull();
    expect(executor.getUndoStackSize()).toBe(before);
  });

  it('rolls back EARLIER commands in the same call when a later one strays', () => {
    const { state, deps } = world(REGION);
    const r = runStroke(deps, [paint({ x: 2, y: 2 }), paint({ x: 8, y: 2 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(true);
    expect(state.cells[2]![2]!.terrain).toBeNull();
  });

  it('tells the model where it strayed and what the bounds are, so it can re-plan', () => {
    const { deps } = world(REGION);
    const r = runStroke(deps, [paint({ x: 9, y: 7 })], (n) => `ok ${n}`);
    expect(r.content).toContain('OUT OF REGION');
    expect(r.content).toContain('(9,7)');
    expect(r.content).toContain('(1,1)-(4,4)');
  });
});

describe('commandCells', () => {
  const obj = (x: number, y: number): PlacedObject => ({
    id: 'o1', catalogId: 'building-bamboo-cabin', position: { x, y }, rotation: 0, elevation: 0,
  });

  it('counts an object by its whole FOOTPRINT, not its anchor', () => {
    // A building whose corner is inside and whose body is outside is outside.
    const cells = commandCells({
      type: CommandType.PlaceObject, timestamp: 0, object: obj(4, 4), loadValue: 0,
    } as Command);
    expect(cells.length).toBeGreaterThan(1);
    expect(cells).toContainEqual({ x: 4, y: 4 });
    expect(cells.some((c) => c.x > 4 || c.y > 4)).toBe(true);
  });

  it('counts a removal by footprint too, so the agent cannot reach out and delete', () => {
    const cells = commandCells({
      type: CommandType.RemoveObject, timestamp: 0, objectId: 'o1', removedObject: obj(6, 6),
    } as Command);
    expect(cells).toContainEqual({ x: 6, y: 6 });
  });

  it('reads terrain commands as their own cell list', () => {
    expect(commandCells(paint({ x: 1, y: 2 }, { x: 3, y: 4 })))
      .toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('covers a half-anchored (halfStep) footprint by its actual integer cells, not position + offset', () => {
    // ramp-teak-stair is 2 wide x 4 tall; a half x-anchor covers 3 columns (floor/ceil expansion),
    // never a fractional key like "7.5,5" — `position.x + dx` would produce exactly that, and no
    // integer-keyed region-membership set would ever match it.
    const halfObj: PlacedObject = {
      id: 'r1', catalogId: 'ramp-teak-stair', position: { x: 7.5, y: 5 }, rotation: 0, elevation: 1,
    };
    const cells = commandCells({
      type: CommandType.PlaceObject, timestamp: 0, object: halfObj, loadValue: 100,
    } as Command);
    expect(cells).toHaveLength(3 * 4);
    expect(cells.every((c) => Number.isInteger(c.x) && Number.isInteger(c.y))).toBe(true);
    expect(cells).toContainEqual({ x: 7, y: 5 });
    expect(cells).toContainEqual({ x: 9, y: 8 });
  });
});

describe('a half-anchored ramp partially over the region boundary', () => {
  // The plateau/shoulder/water lane from half-step-detection.test.ts's case (a): a ramp anchored
  // at (4.5, 10) can ONLY snap at the half x-anchor, landing at { x: 4.5, y: 9 } — width 2 (covers
  // x = 4, 5, 6), height 4 (covers y = 9..12).
  function rampMap(size = 20): GridState {
    const state = makeState(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setZone(state, x, y, CellZone.Grass);
    for (let y = 0; y <= 9; y++) for (let x = 0; x < size; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = 10; y <= 14; y++) {
      setTerrain(state, 7, y, TerrainType.Mountain, 1);
      setTerrain(state, 4, y, TerrainType.Water, 0);
    }
    return state;
  }
  const rampCmd = (): Command => ({
    type: CommandType.PlaceObject, timestamp: 0,
    object: { id: 'r1', catalogId: 'ramp-teak-stair', position: { x: 4.5, y: 10 }, rotation: 0, elevation: 0 },
    loadValue: 100,
  });
  function place(region: MacroCoord[]) {
    const state = rampMap();
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const deps = { getState: () => state, getExecutor: () => executor, getRegion: () => region } as unknown as AgentToolDeps;
    return { state, executor, deps };
  }

  it('refuses when the snapped footprint reaches outside it, even by one half-covered column', () => {
    // Region columns 1..5 only — the ramp's far column (x = 6, covered by the half x-anchor's
    // floor/ceil expansion) is just outside it.
    const region: MacroCoord[] = [];
    for (let y = 1; y <= 12; y++) for (let x = 1; x <= 5; x++) region.push({ x, y });
    const { state, executor, deps } = place(region);
    const before = executor.getUndoStackSize();
    const r = runStroke(deps, [rampCmd()], (n) => `ok ${n}`);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('OUT OF REGION');
    expect(state.objects.size).toBe(0);
    expect(executor.getUndoStackSize()).toBe(before);
  });

  it('applies once the region covers the whole half-anchored footprint', () => {
    const region: MacroCoord[] = [];
    for (let y = 1; y <= 14; y++) for (let x = 1; x <= 8; x++) region.push({ x, y });
    const { state, deps } = place(region);
    const r = runStroke(deps, [rampCmd()], (n) => `ok ${n}`);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBe(1);
    expect(state.objects.get('r1')?.position).toEqual({ x: 4.5, y: 9 });
  });
});

/* ── the callback variant: the same rule over what the body actually issued ── */

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

function rect(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push({ x, y });
  return out;
}

const covers = (region: MacroCoord[], c: MacroCoord) => region.some((r) => r.x === c.x && r.y === c.y);

const smallBuilding = () => getCatalogByCategory(ItemCategory.Building).find((i) => i.width <= 3 && i.height <= 3)!;
const rotatableBuilding = () => getCatalogByCategory(ItemCategory.Building)
  .find((i) => i.rotatable && i.width <= 3 && i.height <= 3)!;

describe('build_road', () => {
  it('refuses a path that leaves the region, and lays nothing', async () => {
    const { state, executor, deps } = world(REGION);
    const before = executor.getUndoStackSize();
    const r = await executeToolCall(call('build_road', { line: { x1: 2, y1: 2, x2: 9, y2: 2 } }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('OUT OF REGION');
    expect(r.content).toContain('(1,1)-(4,4)');
    expect(state.objects.size).toBe(0);
    expect(executor.getUndoStackSize()).toBe(before);
  });

  it('lays the same kind of path when it stays inside', async () => {
    const { state, deps } = world(REGION);
    const r = await executeToolCall(call('build_road', { line: { x1: 1, y1: 2, x2: 4, y2: 2 } }), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(0);
  });
});

describe('scatter_objects', () => {
  const floraId = () => getCatalogByCategory(ItemCategory.Flora)[0]!.id;
  const scatter = { catalogIds: [] as string[], count: 8, rect: { x1: 6, y1: 6, x2: 10, y2: 10 } };

  it('scatters into that rect with no region painted', async () => {
    const { state, deps } = world([]);
    const r = await executeToolCall(call('scatter_objects', { ...scatter, catalogIds: [floraId()] }), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('refuses the same rect once the user has painted elsewhere', async () => {
    const { state, executor, deps } = world(REGION);
    const before = executor.getUndoStackSize();
    const r = await executeToolCall(call('scatter_objects', { ...scatter, catalogIds: [floraId()] }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('OUT OF REGION');
    expect(state.objects.size).toBe(0);
    expect(executor.getUndoStackSize()).toBe(before);
  });
});

describe('rotate_object', () => {
  it('refuses to turn an object standing outside the region, leaving its facing alone', async () => {
    const { state, executor, deps } = world(REGION);
    state.objects.set('o1', {
      id: 'o1', catalogId: rotatableBuilding().id, position: { x: 8, y: 8 }, rotation: 0, elevation: 0,
    });
    const before = executor.getUndoStackSize();
    const r = await executeToolCall(call('rotate_object', { objectId: 'o1', rotation: 90 }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('OUT OF REGION');
    expect(state.objects.get('o1')?.rotation).toBe(0);
    expect(executor.getUndoStackSize()).toBe(before);
  });

  it('turns one standing inside it', async () => {
    const { state, deps } = world(REGION);
    state.objects.set('o1', {
      id: 'o1', catalogId: rotatableBuilding().id, position: { x: 1, y: 1 }, rotation: 0, elevation: 0,
    });
    const r = await executeToolCall(call('rotate_object', { objectId: 'o1', rotation: 90 }), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.get('o1')?.rotation).toBe(90);
  });
});

describe('decorate_zone', () => {
  const far = { x: 14, y: 14, w: 14, h: 14, theme: 'orchard' };

  it('decorates that rect with no region painted', async () => {
    const { state, deps } = world([], 32, 32);
    const r = await executeToolCall(call('decorate_zone', far), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('refuses the same rect once the user has painted elsewhere', async () => {
    const region = rect(1, 1, 6, 6);
    const { state, executor, deps } = world(region, 32, 32);
    const before = executor.getUndoStackSize();
    const r = await executeToolCall(call('decorate_zone', far), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('OUT OF REGION');
    expect(r.content).toContain('(1,1)-(6,6)');
    expect(state.objects.size).toBe(0);
    expect(executor.getUndoStackSize()).toBe(before);
  });
});

describe('plant_forest', () => {
  const far = { x: 2, y: 2, w: 20, h: 20, density: 0.8 };

  it('plants that rect with no region painted', async () => {
    const { state, deps } = world([], 32, 32);
    const r = await executeToolCall(call('plant_forest', far), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('refuses the same rect once the user has painted elsewhere', async () => {
    const region = rect(25, 25, 30, 30);
    const { state, executor, deps } = world(region, 32, 32);
    const before = executor.getUndoStackSize();
    const r = await executeToolCall(call('plant_forest', far), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('OUT OF REGION');
    expect(r.content).toContain('(25,25)-(30,30)');
    expect(state.objects.size).toBe(0);
    expect(executor.getUndoStackSize()).toBe(before);
  });
});

describe('build_road_network', () => {
  /** Two houses inside the region, one far outside it, all pre-existing. */
  function houses(state: ReturnType<typeof world>['state']) {
    const b = smallBuilding();
    state.objects.set('in-a', { id: 'in-a', catalogId: b.id, position: { x: 4, y: 4 }, rotation: 0, elevation: 0 });
    state.objects.set('in-b', { id: 'in-b', catalogId: b.id, position: { x: 12, y: 12 }, rotation: 0, elevation: 0 });
    state.objects.set('far', { id: 'far', catalogId: b.id, position: { x: 26, y: 26 }, rotation: 0, elevation: 0 });
  }
  const seeded = { id: new Set(['in-a', 'in-b', 'far']) };
  const laid = (state: ReturnType<typeof world>['state']) =>
    [...state.objects.values()].filter((o) => !seeded.id.has(o.id));

  it('routes across the whole map with no region painted', async () => {
    const { state, deps } = world([], 32, 32);
    houses(state);
    const r = await executeToolCall(call('build_road_network', { seed: 7 }), deps);
    expect(r.isError).toBe(false);
    expect(laid(state).some((o) => o.position.x > 16 || o.position.y > 16)).toBe(true);
  });

  it('plans inside the region instead of being refused for straying', async () => {
    const region = rect(2, 2, 16, 16);
    const { state, deps } = world(region, 32, 32);
    houses(state);
    const r = await executeToolCall(call('build_road_network', { seed: 7 }), deps);
    expect(r.content).not.toContain('OUT OF REGION');
    expect(laid(state).length).toBeGreaterThan(0);
    for (const o of laid(state)) expect(covers(region, o.position)).toBe(true);
  });
});

describe('frame_crossing', () => {
  /** A one-tier plateau over the right half, so the seam at x=16 is a ramp site. */
  function cliff(state: ReturnType<typeof world>['state']) {
    for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  }

  it('realizes a crossing at the seam with no region painted', async () => {
    const { state, deps } = world([], 32, 32);
    cliff(state);
    const r = await executeToolCall(call('frame_crossing', { x: 15, y: 11 }), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('scans only the region, so a seam outside it is never touched', async () => {
    const region = rect(1, 1, 6, 6); // low ground only — the seam is nowhere near it
    const { state, deps } = world(region, 32, 32);
    cliff(state);
    const r = await executeToolCall(call('frame_crossing', { x: 15, y: 11 }), deps);
    expect(r.content).not.toContain('OUT OF REGION');
    expect(state.objects.size).toBe(0);
  });
});
