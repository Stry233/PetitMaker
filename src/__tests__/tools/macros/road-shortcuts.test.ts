import { expect, it } from 'vitest';
import { ItemCategory, TerrainType } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';
import { applyMacro } from '../../../tools/macros';
import { makeExecutor, makeState, setTerrain } from '../../rules/_helpers';

function map() {
  const state = makeState(56, 56), executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

it.each([false, true])('bridges a finite pond even when the banks connect around it (transpose=%s)', transpose => {
  const ctx = map();
  for (let y = 5; y <= 49; y++) for (let x = 25; x <= 28; x++) setTerrain(ctx.state, transpose ? y : x, transpose ? x : y, TerrainType.Water, 0);
  const from = transpose ? { x: 28, y: 12 } : { x: 12, y: 28 };
  const at = transpose ? { x: 28, y: 43 } : { x: 43, y: 28 };
  const result = applyMacro(ctx, 'road-link', { seed: 3, from, at, width: 2 });
  expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
  const bridges = [...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Bridge);
  expect(bridges).toHaveLength(1);
  for (const road of [...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Road)) {
    expect(transpose ? road.position.x : road.position.y).toBeGreaterThanOrEqual(28);
    expect(transpose ? road.position.x : road.position.y).toBeLessThanOrEqual(29);
  }
  expect(Math.abs((transpose ? bridges[0]!.position.x : bridges[0]!.position.y) - 28)).toBeLessThanOrEqual(4);
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
});

it.each([false, true])('uses an up-and-down ramp pair across a long plateau (transpose=%s)', transpose => {
  const ctx = map();
  for (let y = 3; y <= 52; y++) for (let x = 23; x <= 33; x++) setTerrain(ctx.state, transpose ? y : x, transpose ? x : y, TerrainType.Mountain, 1);
  const from = transpose ? { x: 28, y: 10 } : { x: 10, y: 28 };
  const at = transpose ? { x: 28, y: 46 } : { x: 46, y: 28 };
  const result = applyMacro(ctx, 'road-link', { seed: 3, from, at, width: 2 });
  expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
  const ramps = [...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Ramp);
  expect(ramps).toHaveLength(2);
  for (const road of [...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Road)) {
    expect(transpose ? road.position.x : road.position.y).toBeGreaterThanOrEqual(28);
    expect(transpose ? road.position.x : road.position.y).toBeLessThanOrEqual(29);
  }
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
});

it('keeps a direct open route free of gratuitous crossings', () => {
  const ctx = map();
  for (let y = 5; y <= 49; y++) for (let x = 25; x <= 28; x++) setTerrain(ctx.state, x, y, TerrainType.Water, 0);
  const out = applyMacro(ctx, 'road-link', { seed: 3, from: { x: 8, y: 14 }, at: { x: 8, y: 42 }, width: 2 });
  expect(out.changes).toBeGreaterThan(0);
  expect([...ctx.state.objects.values()].some(o => categoryOf(o) === ItemCategory.Bridge)).toBe(false);
});

it.each([false, true])('crosses a narrow plateau with ramps instead of walking around its end (transpose=%s)', transpose => {
  const ctx = map();
  for (let y = 10; y <= 45; y++) for (let x = 24; x <= 26; x++) setTerrain(ctx.state, transpose ? y : x, transpose ? x : y, TerrainType.Mountain, 1);
  const from = transpose ? { x: 28, y: 12 } : { x: 12, y: 28 };
  const at = transpose ? { x: 28, y: 44 } : { x: 44, y: 28 };
  const result = applyMacro(ctx, 'road-link', { seed: 3, from, at, width: 2 });
  expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
  expect([...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Ramp)).toHaveLength(2);
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
});

it.each([false, true])('climbs two tiers when a terrace has room for a ramp and a short landing (transpose=%s)', transpose => {
  const ctx = map();
  for (let y = 5; y < 51; y++) for (let x = 22; x < 51; x++) setTerrain(ctx.state, transpose ? y : x, transpose ? x : y, TerrainType.Mountain, x >= 28 ? 2 : 1);
  const from = transpose ? { x: 28, y: 12 } : { x: 12, y: 28 };
  const at = transpose ? { x: 28, y: 44 } : { x: 44, y: 28 };
  const result = applyMacro(ctx, 'road-link', { seed: 3, from, at, width: 2 });
  expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
  expect([...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Ramp)).toHaveLength(2);
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
});

it.each([false, true])('bridges a dry ravine between equal-height plateaus (transpose=%s)', transpose => {
  const ctx = map();
  for (let y = 5; y < 51; y++) for (let x = 5; x < 51; x++) if (x < 25 || x > 28) setTerrain(ctx.state, transpose ? y : x, transpose ? x : y, TerrainType.Mountain, 1);
  const from = transpose ? { x: 28, y: 12 } : { x: 12, y: 28 };
  const at = transpose ? { x: 28, y: 44 } : { x: 44, y: 28 };
  const result = applyMacro(ctx, 'road-link', { seed: 3, from, at, width: 2 });
  expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
  expect([...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Bridge)).toHaveLength(1);
  expect([...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Ramp)).toHaveLength(0);
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
});

it.each([
  { transpose: false, bankLength: 1 }, { transpose: true, bankLength: 1 },
  { transpose: false, bankLength: 2 }, { transpose: true, bankLength: 2 },
])('bridges staggered riverbanks $bankLength cells long (transpose=$transpose)', ({ transpose, bankLength }) => {
  const ctx = map();
  for (let y = 3; y < 53; y++) {
    const left = bankLength === 1 ? (y % 2 ? 25 : 26) : Math.floor(y / 2) % 2 ? 25 : 28;
    const span = bankLength === 1 && left === 25 ? 6 : 4;
    for (let x = left; x < left + span; x++) setTerrain(ctx.state, transpose ? y : x, transpose ? x : y, TerrainType.Water, 0);
  }
  const from = transpose ? { x: 28, y: 12 } : { x: 12, y: 28 };
  const at = transpose ? { x: 28, y: 44 } : { x: 44, y: 28 };
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
  const result = applyMacro(ctx, 'road-link', { seed: 3, from, at, width: 2 });
  expect(result.changes, JSON.stringify(result)).toBeGreaterThan(0);
  expect([...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Bridge)).toHaveLength(1);
  const roads = [...ctx.state.objects.values()].filter(o => categoryOf(o) === ItemCategory.Road);
  for (const road of roads) expect(Math.abs((transpose ? road.position.x : road.position.y) - 28)).toBeLessThanOrEqual(2);
  expect(ctx.registry.validatePostStroke(ctx.state)).toEqual([]);
});
