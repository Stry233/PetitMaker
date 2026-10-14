/**
 * A text run's outcome has to reach the caller, or a word that arrived shorter than it was typed
 * arrives with no reason attached.
 *
 * The engine counts three of them — cells crossing a step or a pond, cells at the edge of the ground
 * the word stands on, cells already at the grid's tallest layer — and the editor seam is where that
 * count is either carried or dropped: `generateMap` lands a candidate built on a copy, so it returns
 * the copy's own outcome, and a field the operation forgets to spread is a field no interface can
 * ever show.
 */
import { placeObjectCommand } from '../../../core/model/command-build';
import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainType, type GridState } from '../../../core/model/types';
import { defaultConfig, type StencilConfig, type Stencil } from '../../../tools/generation/recipe';
import { stencilDetail } from '../../../tools/generation/run/outcome';
import { generateMap } from '../../../editor/operations/generate';
import { generateCandidate, __resetCandidateCache } from '../../../tools/generation/run/candidates';
import type { EditContext } from '../../../core/commands/edit-context';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { mapFingerprint } from '../../../core/model/fingerprint';

const SIZE = 24;

function kitOn(build?: (state: GridState) => void): EditContext {
  const state = makeState(SIZE, SIZE);
  build?.(state);
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

/** A solid block of glyph, which is all the outcome cares about. */
function slab(n: number): Stencil {
  return {
    width: n, height: n,
    coverage: new Uint8Array(n * n).fill(255),
    color: new Uint32Array(n * n),
  };
}

function textConfig(origin: { x: number; y: number }, n: number): StencilConfig {
  return defaultConfig('stencil', { seed: 1, maxElevation: 8, stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain: TerrainType.Mountain }, stencil: slab(n), origin } });
}

beforeEach(() => { __resetCandidateCache(); });

describe('a text run reports where it landed', () => {
  it.each([false, true])('clears paving and mountains when the full generation scope is not paved with a scoped run %s', async scoped => {
    const kit = kitOn(state => {
      for (let y = 3; y < 20; y++) for (let x = 3; x < 20; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    });
    const config = textConfig({ x: 8, y: 8 }, 3);
    config.stencilPlan.fill = { kind: 'stroke' };
    config.stencilPlan.stencil.cellAligned = scoped;
    config.stencilPlan.stencil.coverage[4] = 0;
    const originals = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `paving-${i}`, catalogId: 'path-simple-brick', position: { x: 8 + i % 3, y: 8 + Math.floor(i / 3) } })),
      { id: 'old-print', catalogId: 'print-field-corner', position: { x: 8, y: 8 } },
      { id: 'blank-print', catalogId: 'print-field-line', position: { x: 9, y: 9 } },
      { id: 'untouched-print', catalogId: 'print-field-line', position: { x: 15, y: 15 } },
      { id: 'flower', catalogId: 'flower-protea', position: { x: 16, y: 16 } },
    ].map(object => ({ ...object, elevation: 1, rotation: 0 as const }));
    kit.executor.transaction({}, tx => {
      for (const object of originals) expect(kit.executor.execute(placeObjectCommand(object)).success).toBe(true);
      tx.commit();
    });
    const region = scoped ? Array.from({ length: 16 * 16 }, (_, i) => ({ x: 4 + i % 16, y: 4 + Math.floor(i / 16) })) : null;
    const before = mapFingerprint(kit.state);
    const cells = structuredClone(kit.state.cells);
    const candidate = await generateCandidate(kit, { config, region });
    expect(candidate).not.toBeNull();
    expect(mapFingerprint(kit.state)).toBe(before);
    const outcome = await generateMap(kit, { config, region, candidate });
    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBe(8);
    expect(kit.state.cells[16]![16]!.terrain).toBeNull();
    for (let y = 8; y <= 11; y++) for (let x = 8; x <= 11; x++) {
      expect(kit.state.cells[y]![x]!.terrain).toBeNull();
    }
    for (const object of originals) {
      expect(kit.state.objects.has(object.id)).toBe(false);
    }
    const after = mapFingerprint(kit.state);
    expect(after).toBe(mapFingerprint(candidate!.state));
    kit.executor.undo();
    expect(kit.state.cells).toEqual(cells);
    expect([...kit.state.objects.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...originals].sort((a, b) => a.id.localeCompare(b.id)));
    kit.executor.redo();
    expect(mapFingerprint(kit.state)).toBe(after);
  });

  it('preserves the previous generation and undo history when the structural minimum cannot fit', async () => {
    const kit = kitOn();
    const original = textConfig({ x: 0, y: 0 }, 8);
    original.stencilPlan.fill = { kind: 'object', catalogId: 'flower-protea' };
    await generateMap(kit, { config: original, region: null });
    expect(kit.state.objects.size).toBe(64);
    const before = mapFingerprint(kit.state), history = kit.executor.historyDepth();
    const dense = textConfig({ x: 0, y: 0 }, 16);
    dense.stencilPlan.fill = { kind: 'object', catalogId: 'tree-apple' };
    dense.stencilPlan.stencil.coverage.forEach((_, i, coverage) => {
      coverage[i] = i % 2 === 0 && Math.floor(i / 16) % 2 === 0 ? 255 : 0;
    });
    const result = await generateMap(kit, { config: dense, region: null });
    expect(result.detail).toEqual({ kind: 'stencil', budget: 'blocked' });
    expect(mapFingerprint(kit.state)).toBe(before);
    expect(kit.executor.historyDepth()).toBe(history);
  });

  it('carries the tier and the three skip counts out through the editor', async () => {
    const kit = kitOn();
    const outcome = await generateMap(kit, { config: textConfig({ x: 8, y: 8 }, 6), region: null });
    expect(outcome.cancelled).toBe(false);
    expect(stencilDetail(outcome)?.landing).toEqual({ base: 0, offBase: 0, unsupported: 0, atCeiling: 0 });
    expect(outcome.violations).toEqual([]);
  });

  it('carries the counts, not just the shape of them', async () => {
    // Every run clears its scope first, so a full-map text run always writes on bare ground. Here
    // the scope is a small square inside the word, so the ground under the rest of it survives the
    // clearing and the glyph really does straddle a step: the cleared cells stand on another surface
    // and the plateau's rim cannot carry a layer four over sea-level ground.
    const kit = kitOn((state) => {
      for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    });
    const scope: { x: number; y: number }[] = [];
    for (let y = 9; y < 12; y++) for (let x = 9; x < 12; x++) scope.push({ x, y });
    const outcome = await generateMap(kit, { config: textConfig({ x: 7, y: 7 }, 10), region: scope });
    const landing = stencilDetail(outcome)?.landing;
    expect(landing?.base).toBe(3);
    expect(landing?.offBase).toBe(scope.length);      // the cells the clearing took down to ground
    expect(landing?.unsupported).toBeGreaterThan(0);  // the plateau's own rim
    expect(outcome.violations).toEqual([]);
  });

  it('says nothing about a run that was not text', async () => {
    const kit = kitOn();
    const outcome = await generateMap(kit, {
      config: defaultConfig('maze', { seed: 3, maxElevation: 3 }),
      region: null,
    });
    expect(stencilDetail(outcome)).toBeUndefined();
  });
});

describe('the recipe a stencil run leaves on the map', () => {
  it('keeps the settings and seed without the stencil arrays', async () => {
    const kit = kitOn();
    const config = textConfig({ x: 4, y: 4 }, 8);
    await generateMap(kit, { config, region: null });
    const { stencilPlan: _plan, ...settings } = config;
    expect(kit.state.generation).toEqual(settings);
  });
});
