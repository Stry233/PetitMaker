import { describe, expect, it } from 'vitest';
import { hashJSON } from '../../../../core/base/hash';
import { TerrainType } from '../../../../core/model/types';
import { type StencilPlan } from '../../../../tools/generation/recipe';
import { runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { declaredColorPalette } from '../../../../tools/generation/stencil/stencil-palette';
import { makeState, makeExecutor } from '../../../_support/map-state';

function generate(kind: string, side: number): string {
  const state = makeState(40, 40);
  state.ignoreChunkLoad = true;
  const coverage = new Uint8Array(side * side);
  const color = new Uint32Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = y * side + x;
    coverage[i] = x === 0 && y % 3 === 0 ? 0 : 255;
    color[i] = [0xe96665, 0x6aad77, 0xf1d16d, 0x385482, 0xeeeeee][(x + 3 * y) % 5]!;
  }
  const palette = declaredColorPalette('flora');
  const plan: StencilPlan = {
    read: kind === 'text' ? 'shape' : 'color',
    fill: { kind: 'object', catalogId: 'flower-protea' },
    origin: { x: 4, y: 4 }, stencil: { width: side, height: side, coverage, color, nature: 'flat' },
    ...(kind === 'image' ? { objectPalette: palette } : {}),
    ...(kind === 'mixed' ? { objectPalette: declaredColorPalette('roads'), decor: { palette } } : {}),
    ...(kind === 'terrain' ? { water: 'palette' as const, decor: { palette } } : {}),
  };
  if (kind === 'terrain') plan.fill = { kind: 'terrain', terrain: TerrainType.Mountain };
  const executor = makeExecutor(state);
  const result = runStencilPlan(state, plan, 3, c => executor.execute(c));
  return hashJSON({
    result,
    objects: [...state.objects.values()].map(({ id: _id, ...object }) => object),
    cells: state.cells.map(row => row.map(cell => cell.terrain)),
  });
}

describe('unrestricted stencil compatibility', () => {
  it('preserves the pre-budget material choices, geometry and insertion order', () => {
    expect(['text', 'image', 'mixed', 'terrain'].flatMap(kind => [7, 16, 24].map(side => [kind, side, generate(kind, side)]))).toMatchInlineSnapshot(`
      [
        [
          "text",
          7,
          "2f4b0558",
        ],
        [
          "text",
          16,
          "6a6a6e5e",
        ],
        [
          "text",
          24,
          "5c648b55",
        ],
        [
          "image",
          7,
          "5722a228",
        ],
        [
          "image",
          16,
          "7a42d792",
        ],
        [
          "image",
          24,
          "cbcf9cba",
        ],
        [
          "mixed",
          7,
          "1ef1dce5",
        ],
        [
          "mixed",
          16,
          "df4b82fb",
        ],
        [
          "mixed",
          24,
          "5b3c28e6",
        ],
        [
          "terrain",
          7,
          "e3fdd1ce",
        ],
        [
          "terrain",
          16,
          "0e1b3233",
        ],
        [
          "terrain",
          24,
          "b90f5e04",
        ],
      ]
    `);
  });
});
