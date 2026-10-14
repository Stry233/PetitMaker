/**
 * The designed generator's bridge scan reads a bank's standable surface the way placement does: a
 * corner patch over bare ground is ground, so a deck lands on it.
 */
import { describe, expect, it } from 'vitest';
import { TerrainType, type GridState } from '../../../../../core/model/types';
import { surfaceElevation } from '../../../../../core/domain/terrain/terrain-surface';
import { makeRng } from '../../../../../core/base/rng';
import { getCatalogItem, getPlaceableByCategory } from '../../../../../state/catalog';
import { layBridges } from '../../../../../tools/generation/designer/build/crossings';
import { makeScope } from '../../../../../tools/generation/designer/build/scope';
import { makeCtx, tryPlace } from '../../../../../tools/placement/object';
import { makeExecutor, makeState, setTerrain } from '../../../../_support/map-state';
import { ItemCategory } from '../../../../../config/catalog/categories';

const W = 30, H = 20;
const RIVER = { x0: 12, x1: 14 };

function river(patchBanks: boolean): GridState {
  const state = makeState(W, H);
  for (let y = 0; y < H; y++) for (let x = RIVER.x0; x <= RIVER.x1; x++) setTerrain(state, x, y, TerrainType.Water, 0);
  if (patchBanks) {
    for (let y = 0; y < H; y++) {
      for (const x of [RIVER.x0 - 1, RIVER.x1 + 1]) {
        state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 1, patchOnly: true, patchBase: 0, corners: [1, 0, 0, 0] } as never;
      }
    }
  }
  return state;
}

function bridgesOver(state: GridState): number {
  const executor = makeExecutor(state);
  const place = makeCtx(state, (c) => executor.execute(c), executor.getRegistry(), 3);
  const material = getPlaceableByCategory(ItemCategory.Road)[0]!.id;
  for (let y = 6; y <= 14; y++) {
    for (const x of [RIVER.x0 - 4, RIVER.x0 - 3, RIVER.x1 + 3, RIVER.x1 + 4]) tryPlace(place, material, x, y);
  }
  const pavable = new Uint8Array(W * H);
  const surface = new Int8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = state.cells[y]![x]!.terrain;
      pavable[y * W + x] = t?.type === TerrainType.Water ? 0 : 1;
      surface[y * W + x] = t?.type === TerrainType.Water ? -1 : surfaceElevation(t);
    }
  }
  return layBridges(
    { place, pavable, surface, material, scope: makeScope(null, W, H) }, { rng: makeRng(5), budget: 2, refused: { crossings: 0 } },
  );
}

const hasBridge = (state: GridState) =>
  [...state.objects.values()].some((o) => getCatalogItem(o.catalogId)?.category === ItemCategory.Bridge);

describe('designed bridges', () => {
  it('lands a deck between two plain banks', () => {
    const state = river(false);
    expect(bridgesOver(state)).toBeGreaterThan(0);
    expect(hasBridge(state)).toBe(true);
  });

  it('reads a corner patch over bare ground on a bank as ground', () => {
    const state = river(true);
    expect(surfaceElevation(state.cells[10]![RIVER.x1 + 1]!.terrain)).toBe(0);
    expect(bridgesOver(state)).toBeGreaterThan(0);
    expect(hasBridge(state)).toBe(true);
  });
});
