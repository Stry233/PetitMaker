import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, expect, it } from 'vitest';
import { CHUNK_LOAD_LIMIT } from '../../../../core/game/profile';
import { CommandType, type GridState } from '../../../../core/model/types';
import { type Stencil, type StencilPlan } from '../../../../tools/generation/recipe';
import { getMapStats } from '../../../../state/map-stats';
import { budgetStencil } from '../../../../tools/generation/stencil/stencil-budget';
import { layStencilDecor, runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { LoadBudget } from '../../../../state/load-budget';
import { makeState, makeExecutor } from '../../../_support/map-state';

const flower = { catalogId: 'flower-protea', rgb: 0x808080 };
function slab(size: number): Stencil {
  return { width: size, height: size, coverage: new Uint8Array(size * size).fill(255), color: new Uint32Array(size * size).fill(flower.rgb), nature: 'flat' };
}
function plan(size = 16): StencilPlan {
  return { read: 'color', stencil: slab(size), origin: { x: 0, y: 0 }, objectPalette: [flower] };
}
function run(state: GridState, source: StencilPlan) {
  const executor = makeExecutor(state);
  const whole = executor.beginStroke();
  const refusals: string[] = [];
  const result = runStencilPlan(state, source, 3, command => {
    const out = executor.execute(command);
    refusals.push(...out.errors.map(error => error.ruleId));
    return out;
  });
  expect(whole.commit()).toEqual([]);
  return { result, refusals };
}

describe('complete stencils under regional budgets', () => {
  it('retains small contrasting facial details before spending load on fill', () => {
    const source = plan();
    const accent = { catalogId: 'flower-amaryllis', rgb: 0xdd2020 };
    source.objectPalette = [flower, accent];
    const original = Array.from({ length: 256 }, () => flower);
    const eyes = [5 * 16 + 5, 5 * 16 + 10];
    for (const i of eyes) { source.stencil.color[i] = accent.rgb; original[i] = accent; }
    const prepared = budgetStencil(makeState(), source, () => original);
    for (const i of eyes) expect(prepared?.matches[i]).toEqual(accent);
  });

  it('restores the base object when a decoration fails a non-budget placement check', () => {
    const state = makeState();
    const executor = makeExecutor(state);
    const base = { id: 'base', catalogId: 'road-asphalt', position: { x: 1, y: 1 }, rotation: 0 as const, elevation: 0 };
    expect(executor.execute(placeObjectCommand(base)).success).toBe(true);
    const stencil = slab(3);
    stencil.color[4] = 0xff0000;
    const result = layStencilDecor(state, { stencil, origin: { x: 0, y: 0 } }, { palette: [{ ...flower, rgb: 0xff0000 }] }, cmd => {
      if (cmd.type === CommandType.PlaceObject && cmd.object.catalogId === flower.catalogId) return { success: false, errors: [] };
      return executor.execute(cmd);
    }, { replaceable: new Set([base.id]), primary: [{ rgb: 0x808080 }], paved: true });
    expect(result.placed).toBe(0);
    expect(state.objects.get(base.id)).toEqual(base);
  });

  it('preserves the full image frame and all four sides under a tight budget', () => {
    const state = makeState(20, 20);
    const { result, refusals } = run(state, plan());
    expect(result.budget).toBe('adapted');
    expect(result.placed).toBe(100);
    expect(result.skipped).toBe(0);
    expect(refusals).toEqual([]);
    const positions = [...state.objects.values()].map(object => object.position);
    expect(Math.min(...positions.map(p => p.x))).toBe(0);
    expect(Math.max(...positions.map(p => p.x))).toBe(15);
    expect(Math.min(...positions.map(p => p.y))).toBe(0);
    expect(Math.max(...positions.map(p => p.y))).toBe(15);
    expect([...getMapStats(state).chunks.values()].every(chunk => chunk.load <= CHUNK_LOAD_LIMIT)).toBe(true);
  });

  it('keeps the original layout exactly when it already fits', () => {
    const limited = makeState(20, 20), unlimited = makeState(20, 20);
    unlimited.ignoreChunkLoad = true;
    expect(run(limited, plan(8)).result).toEqual(run(unlimited, plan(8)).result);
    const objects = (state: GridState) => [...state.objects.values()].map(({ id: _id, ...object }) => object);
    expect(objects(limited)).toEqual(objects(unlimited));
  });

  it('charges existing loads using the shifted region grid', () => {
    const state = makeState(32, 32);
    state.template.chunkGrid = { origin: { x: -4, y: -4 }, columns: 3, rows: 3 };
    for (let i = 0; i < 50; i++) state.objects.set(`existing-${i}`, {
      id: `existing-${i}`, catalogId: flower.catalogId, position: { x: 0, y: 0 }, rotation: 0, elevation: 0,
    });
    const prepared = budgetStencil(state, plan(), candidate => Array(candidate.stencil.width * candidate.stencil.height).fill(flower));
    expect(prepared?.adapted).toBe(true);
    expect(prepared!.plan.stencil.width).toBe(16);
    const budget = new LoadBudget(state);
    prepared!.matches.forEach((entry, i) => {
      if (entry) budget.change({ id: '', catalogId: entry.catalogId, position: { x: i % 16, y: Math.floor(i / 16) }, rotation: 0, elevation: 0 }, 1);
    });
    expect(budget.fits).toBe(true);
    expect(state.objects.size).toBe(50);
  });

  it('keeps the chosen material and color while reducing density', () => {
    const expensive = { catalogId: 'tree-apple', rgb: 0x808080 };
    const cheaper = { catalogId: 'tree-fir', rgb: 0x888888 };
    const source = { ...plan(7), objectPalette: [expensive, cheaper] };
    const prepared = budgetStencil(makeState(), source, () => Array(49).fill(expensive));
    expect(prepared?.plan.stencil.width).toBe(7);
    expect(prepared?.matches.filter(Boolean)).toHaveLength(16);
    expect(prepared?.matches.every(entry => !entry || entry.catalogId === expensive.catalogId)).toBe(true);
  });

  it('does not exploit unknown loads as free color substitutes', () => {
    const source = { ...plan(), objectPalette: [flower, { catalogId: 'shrub', rgb: 0x818181 }] };
    const prepared = budgetStencil(makeState(), source, candidate => Array(candidate.stencil.width * candidate.stencil.height).fill(flower));
    expect(prepared?.plan.stencil.width).toBe(16);
    expect(prepared?.matches.filter(Boolean)).toHaveLength(100);
    expect(prepared?.matches.every(entry => !entry || entry.catalogId === flower.catalogId)).toBe(true);
  });

  it('retains unknown items when they were already selected', () => {
    const unknown = { catalogId: 'shrub', rgb: 0x808080 };
    const source = { ...plan(), objectPalette: [unknown] };
    const prepared = budgetStencil(makeState(), source, () => Array(256).fill(unknown));
    expect(prepared?.adapted).toBe(false);
    expect(prepared?.plan).toBe(source);
  });

  it('retains every originally matched zero-load cell in a mixed-cost image', () => {
    const unknown = { catalogId: 'shrub', rgb: 0x818181 };
    const source = { ...plan(), objectPalette: [flower, unknown] };
    const original = Array.from({ length: 256 }, (_, i) => i % 2 ? unknown : flower);
    const prepared = budgetStencil(makeState(), source, () => original);
    expect(prepared?.adapted).toBe(true);
    for (let i = 1; i < original.length; i += 2) expect(prepared?.matches[i]).toBe(unknown);
  });

  it('keeps zero-load paving at its original size', () => {
    const state = makeState();
    const result = run(state, { ...plan(), objectPalette: [{ catalogId: 'road-asphalt', rgb: 0x808080 }] });
    expect(result.result.budget).toBeUndefined();
    expect(result.result.placed).toBe(256);
  });

  it('retains a glyph counter and its size while thinning the surrounding strokes', () => {
    const stencil = slab(16);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) stencil.coverage[y * 16 + x] = 0;
    const source: StencilPlan = { ...plan(), stencil, read: 'shape', objectPalette: undefined, fill: { kind: 'object', catalogId: flower.catalogId } };
    const state = makeState();
    const { result, refusals } = run(state, source);
    expect(result.budget).toBe('adapted');
    expect(result.placed).toBe(100);
    expect(result.skipped).toBe(0);
    expect(refusals).toEqual([]);
    expect(source.stencil.width).toBe(16);
    for (const object of state.objects.values()) {
      const { x, y } = object.position;
      expect(x < 4 || x >= 12 || y < 4 || y >= 12).toBe(true);
    }
  });

  it('blocks an unreadably sparse shape before issuing any commands', () => {
    const state = makeState();
    for (let i = 0; i < 100; i++) state.objects.set(`existing-${i}`, {
      id: `existing-${i}`, catalogId: flower.catalogId, position: { x: 0, y: 0 }, rotation: 0, elevation: 0,
    });
    const { result, refusals } = run(state, { ...plan(), read: 'shape', fill: { kind: 'object', catalogId: flower.catalogId } });
    expect(result.budget).toBe('blocked');
    expect(state.objects.size).toBe(100);
    expect(refusals).toEqual([]);
  });

  it('adds detail progressively as more budget becomes available', () => {
    const selections: Set<number>[] = [];
    for (const occupied of [60, 40, 20, 0]) {
      const state = makeState();
      for (let i = 0; i < occupied; i++) state.objects.set(`existing-${i}`, {
        id: `existing-${i}`, catalogId: flower.catalogId, position: { x: 0, y: 0 }, rotation: 0, elevation: 0,
      });
      const prepared = budgetStencil(state, plan(), () => Array(256).fill(flower));
      expect(prepared).not.toBeNull();
      selections.push(new Set(prepared!.matches.flatMap((entry, i) => entry ? [i] : [])));
    }
    for (let i = 1; i < selections.length; i++) {
      expect([...selections[i - 1]!].every(index => selections[i]!.has(index))).toBe(true);
      expect(selections[i]!.size).toBeGreaterThan(selections[i - 1]!.size);
    }
  });
});
