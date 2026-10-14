import { placeObjectCommand, removeObjectCommand } from '../../../core/model/command-build';
import { beforeEach, describe, expect, it } from 'vitest';
import { TerrainType, type GridState } from '../../../core/model/types';
import { defaultConfig, type StencilConfig } from '../../../tools/generation/recipe';
import { decodeGridState, encodeGridState } from '../../../core/model/grid-wire';
import { makeExecutor, makeState, setTerrain } from '../../_support/map-state';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { __resetCandidateCache, generateCandidate } from '../../../tools/generation/run/candidates';
import { generateMap } from '../../../editor/operations/generate';
import { runCandidateOn } from '../../../tools/generation/run/generation-run';

function context(size = 24) {
  const state = makeState(size, size), executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

function config(x = 6, y = 6, sparse = false): StencilConfig {
  return defaultConfig('stencil', { maxElevation: 3, seed: 1, stencilPlan: {
      read: 'shape', fill: { kind: 'stroke' }, origin: { x, y },
      stencil: {
        width: 3, height: 3, coverage: Uint8Array.from({ length: 9 }, (_, i) => !sparse || i === 0 ? 255 : 0), color: new Uint32Array(9),
        cellAligned: true,
      },
    } });
}

const objects = (state: GridState) => [...state.objects.values()].sort((a, b) => a.id.localeCompare(b.id));

beforeEach(__resetCandidateCache);

describe('print regeneration', () => {
  it.each([0, 1])('retains a completely paved level-%s background through regeneration and worker builds', async elevation => {
    const kit = context();
    if (elevation) {
      for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) setTerrain(kit.state, x, y, TerrainType.Mountain, elevation);
    }
    const region = Array.from({ length: 9 }, (_, i) => ({ x: 6 + i % 3, y: 6 + Math.floor(i / 3) }));
    kit.executor.transaction({}, tx => {
      for (const [i, position] of region.entries()) expect(kit.executor.execute(placeObjectCommand({
        id: `road-${i}`, catalogId: 'path-simple-brick', position, elevation, rotation: 0,
      })).success).toBe(true);
      expect(tx.commit()).toEqual([]);
    });
    const before = objects(kit.state), cells = structuredClone(kit.state.cells);
    const worker = decodeGridState(encodeGridState(kit.state), kit.state.template);
    const run = await runCandidateOn(worker, { config: config(), region, rules: 'default' });
    expect(run.outcome.placed).toBe(9);
    for (const road of before) expect(worker.objects.get(road.id)).toEqual(road);
    const candidate = await generateCandidate(kit, { config: config(), region });
    await generateMap(kit, { config: config(), region, candidate });
    expect(mapFingerprint(kit.state)).toBe(mapFingerprint(candidate!.state));
    await generateMap(kit, { config: config(6, 6, true), region });
    expect(kit.state.objects.size).toBe(10);
    for (const road of before) expect(kit.state.objects.get(road.id)).toEqual(road);
    expect(kit.state.cells).toEqual(cells);
  });

  it('checks the whole buildable map when no region is selected', async () => {
    const kit = context(4);
    kit.executor.transaction({}, tx => {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        expect(kit.executor.execute(placeObjectCommand({
          id: `road-${x}-${y}`, catalogId: 'path-simple-brick', position: { x, y }, elevation: 0, rotation: 0,
        })).success).toBe(true);
      }
      tx.commit();
    });
    const outcome = await generateMap(kit, { config: config(0, 0), region: null });
    expect(outcome.placed).toBe(9);
    expect(kit.state.objects.size).toBe(25);
  });

  it('clears all roads when an unpaved cell lies in the lettering whitespace', async () => {
    const kit = context();
    const region = Array.from({ length: 9 }, (_, i) => ({ x: 6 + i % 3, y: 6 + Math.floor(i / 3) }));
    kit.executor.transaction({}, tx => {
      for (const [i, position] of region.slice(0, 8).entries()) expect(kit.executor.execute(placeObjectCommand({
        id: `road-${i}`, catalogId: 'path-simple-brick', position, elevation: 0, rotation: 0,
      })).success).toBe(true);
      tx.commit();
    });
    await generateMap(kit, { config: config(6, 6, true), region });
    expect(kit.state.objects.size).toBe(1);
    expect([...kit.state.objects.values()][0]!.catalogId).toMatch(/^print-/);
  });

  it('clears roads and terrain when paved parts of an irregular region have different heights', async () => {
    const kit = context();
    for (let y = 14; y <= 15; y++) for (let x = 14; x <= 15; x++) setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
    const region = [{ x: 6, y: 6 }, { x: 14, y: 14 }];
    kit.executor.transaction({}, tx => {
      for (const [elevation, position] of region.entries()) expect(kit.executor.execute(placeObjectCommand({
        id: `road-${elevation}`, catalogId: 'path-simple-brick', position, elevation, rotation: 0,
      })).success).toBe(true);
      expect(tx.commit()).toEqual([]);
    });
    const candidate = await generateCandidate(kit, { config: config(6, 6, true), region });
    const outcome = await generateMap(kit, { config: config(6, 6, true), region, candidate });
    expect(outcome.violations).toEqual([]);
    expect(mapFingerprint(kit.state)).toBe(mapFingerprint(candidate!.state));
    expect(kit.state.objects.has('road-0')).toBe(false);
    expect(kit.state.objects.has('road-1')).toBe(false);
    expect(kit.state.cells[14]![14]!.terrain).toBeNull();
  });

  it('clears flowers from plantable pavement and generates prints over the retained roads', async () => {
    const kit = context();
    const roads = Array.from({ length: 9 }, (_, i) => ({
      id: `road-${i}`, catalogId: 'path-overgrown-dirt',
      position: { x: 6 + i % 3, y: 6 + Math.floor(i / 3) }, elevation: 0, rotation: 0 as const,
    }));
    kit.executor.transaction({}, tx => {
      for (const road of roads) {
        expect(kit.executor.execute(placeObjectCommand(road)).success).toBe(true);
        expect(kit.executor.execute(placeObjectCommand({ ...road, id: `flower-${road.id}`, catalogId: 'flower-protea' })).success).toBe(true);
      }
      expect(tx.commit()).toEqual([]);
    });
    const region = roads.map(road => road.position);
    const before = mapFingerprint(kit.state), originals = objects(kit.state);
    const candidate = await generateCandidate(kit, { config: config(), region });
    expect(mapFingerprint(kit.state)).toBe(before);
    expect(candidate!.outcome.placed).toBe(9);
    const outcome = await generateMap(kit, { config: config(), region, candidate });
    expect(outcome.violations).toEqual([]);
    expect(kit.state.objects.size).toBe(18);
    for (const road of roads) expect(kit.state.objects.get(road.id)).toEqual(road);
    expect(mapFingerprint(kit.state)).toBe(mapFingerprint(candidate!.state));
    kit.executor.undo();
    expect(objects(kit.state)).toEqual(originals);
  });

  it('respects locked objects while clearing unlocked blockers', async () => {
    const kit = context();
    const locked = { id: 'locked', catalogId: 'flower-protea', position: { x: 6, y: 6 }, elevation: 0, rotation: 0 as const, locked: true };
    kit.executor.transaction({}, tx => {
      expect(kit.executor.execute(placeObjectCommand(locked)).success).toBe(true);
      expect(kit.executor.execute(placeObjectCommand({ ...locked, id: 'unlocked', locked: false, position: { x: 7, y: 6 } })).success).toBe(true);
      tx.commit();
    });
    const outcome = await generateMap(kit, { config: config(), region: null });
    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBe(8);
    expect(kit.state.objects.get(locked.id)).toEqual(locked);
    expect(kit.state.objects.has('unlocked')).toBe(false);
  });

  it('removes previous strokes from new whitespace and keeps preview, landing and undo equivalent', async () => {
    const kit = context();
    await generateMap(kit, { config: config(), region: null });
    expect(kit.state.objects.size).toBe(9);
    const previous = objects(kit.state), before = mapFingerprint(kit.state);
    const next = config(6, 6, true);
    const candidate = await generateCandidate(kit, { config: next, region: null });
    expect(mapFingerprint(kit.state)).toBe(before);
    expect(candidate!.state.objects.size).toBe(1);
    await generateMap(kit, { config: next, region: null, candidate });
    expect(objects(kit.state)).toEqual(objects(candidate!.state));
    kit.executor.undo();
    expect(objects(kit.state)).toEqual(previous);
    kit.executor.redo();
    expect(objects(kit.state)).toEqual(objects(candidate!.state));
  });

  it('clears the selected scope including whitespace while limiting new strokes to the allowance', async () => {
    const kit = context();
    await generateMap(kit, { config: config(), region: null });
    const previous = objects(kit.state);
    const next = config(6, 6, true);
    const region = [{ x: 6, y: 6 }, { x: 8, y: 8 }, { x: 7, y: 8 }];
    next.stencilPlan.allow = new Set([6 * 24 + 6, 8 * 24 + 8]);
    await generateMap(kit, { config: next, region });
    expect(kit.state.objects.size).toBe(7);
    for (const old of previous) {
      const removed = region.some(p => p.x === old.position.x && p.y === old.position.y);
      expect(kit.state.objects.has(old.id)).toBe(!removed);
    }
  });

  it('preserves separate generated areas and replaces them when revisited', async () => {
    const kit = context();
    await generateMap(kit, { config: config(), region: null });
    await generateMap(kit, { config: config(14, 14), region: Array.from({ length: 9 }, (_, i) => ({ x: 14 + i % 3, y: 14 + Math.floor(i / 3) })) });
    const distant = objects(kit.state).filter(o => o.position.x >= 14);
    await generateMap(kit, { config: config(6, 6, true), region: Array.from({ length: 9 }, (_, i) => ({ x: 6 + i % 3, y: 6 + Math.floor(i / 3) })) });
    expect(kit.state.objects.size).toBe(10);
    for (const old of distant) expect(kit.state.objects.get(old.id)).toEqual(old);
  });

  it('replaces a cached candidate after the same print has been generated repeatedly', async () => {
    const kit = context();
    const original = config();
    const candidate = await generateCandidate(kit, { config: original, region: null });
    for (let i = 0; i < 3; i++) await generateMap(kit, { config: original, region: null, candidate });
    expect(kit.state.objects.size).toBe(9);
    await generateMap(kit, { config: config(6, 6, true), region: null });
    expect(kit.state.objects.size).toBe(1);
  });

  it('clears manually edited prints with the same scope as generated prints', async () => {
    const kit = context();
    await generateMap(kit, { config: config(), region: null });
    const next = config(6, 6, true);
    const candidate = await generateCandidate(kit, { config: next, region: null });
    const edited = objects(kit.state).find(o => o.position.x === 8 && o.position.y === 8)!;
    const before = mapFingerprint(kit.state);
    kit.executor.transaction({}, tx => {
      expect(kit.executor.execute(removeObjectCommand(edited)).success).toBe(true);
      expect(kit.executor.execute(placeObjectCommand(edited)).success).toBe(true);
      tx.commit();
    });
    expect(mapFingerprint(kit.state)).toBe(before);
    await generateMap(kit, { config: next, region: null, candidate });
    expect(kit.state.objects.size).toBe(1);
    expect(kit.state.objects.has(edited.id)).toBe(false);
  });

  it('keeps curved tile choices consistent between worker previews and live landing', async () => {
    const kit = context(), next = config();
    const stencil = next.stencilPlan.stencil;
    stencil.coverage = new Uint8Array([255, 255, 0, 255, 0, 0, 0, 0, 0]);
    stencil.connections = new Uint8Array([6, 8, 0, 1, 0, 0, 0, 0, 0]);
    stencil.curves = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const worker = decodeGridState(encodeGridState(kit.state), kit.state.template);
    const run = await runCandidateOn(worker, structuredClone({ config: next, region: null, rules: 'default' as const }));
    expect(run.outcome.placed).toBe(3);
    const candidate = await generateCandidate(kit, { config: next, region: null });
    await generateMap(kit, { config: next, region: null, candidate });
    expect(mapFingerprint(kit.state)).toBe(mapFingerprint(candidate!.state));
    const layout = (state: GridState) => [...state.objects.values()].map(({ id: _id, ...object }) => object);
    expect(layout(kit.state)).toEqual(layout(worker));
    expect(layout(kit.state).filter(o => o.catalogId === 'print-field-arc')).toHaveLength(1);
  });

  it('clears detached worker maps without depending on provenance', async () => {
    const kit = context();
    await generateMap(kit, { config: config(), region: null });
    const next = config(6, 6, true);
    const workerState = decodeGridState(encodeGridState(kit.state), kit.state.template);
    expect(workerState.provenance).toBeUndefined();
    const run = await runCandidateOn(workerState, { config: next, region: null, rules: 'default' });
    const candidate = await generateCandidate(kit, { config: next, region: null });
    expect(run.bare).toBe(candidate!.base);
    expect(workerState.objects.size).toBe(1);
    expect(run.outcome.violations).toEqual([]);
    expect(kit.state.objects.size).toBe(9);
  });
});
