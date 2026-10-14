import { describe, expect, it } from 'vitest';
import { TerrainType } from '../../../../core/model/types';
import { defaultConfig, type StencilWaterRole } from '../../../../tools/generation/recipe';
import { generateTerrain } from '../../../../tools/generation';
import { luma } from '../../../../tools/generation/stencil/color';
import { stencilFromPixels, type SourcePixels } from '../../../../tools/generation/stencil/stencil-sample';
import { makeState, makeExecutor } from '../../../_support/map-state';

/** Each eye covers a quarter of its destination cell, so a majority vote would erase it. */
function face(width: number, height: number): SourcePixels {
  const sw = width * 8, sh = height * 8;
  const data = new Uint8Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const eye = y >= 16 && y < 24 && ((x >= 16 && x < 18) || (x >= 32 && x < 34));
    const at = (y * sw + x) * 4;
    data.fill(eye ? 32 : 224, at, at + 3);
    data[at + 3] = 255;
  }
  return { width: sw, height: sh, data };
}

const dimensions = [[7, 7], [13, 13], [19, 19], [7, 40], [40, 7]] as const;

describe('compact image detail', () => {
  it.each(dimensions)('keeps subcell contrast and flat-source classification in a %i × %i drawing', (width, height) => {
    const stencil = stencilFromPixels(face(width, height), { width, height }, { background: false, trim: false })!;
    expect(stencil.nature).toBe('flat');
    const background = luma(stencil.color[3 * width + 3]!);
    expect(luma(stencil.color[2 * width + 2]!)).toBeLessThan(background - 40);
    expect(luma(stencil.color[2 * width + 4]!)).toBeLessThan(background - 40);
    expect(stencil.coverage.every(value => value === 255)).toBe(true);
  });

  it.each([20, 24, 32])('retains majority-color sampling at %i cells', (side) => {
    const stencil = stencilFromPixels(face(side, side), { width: side, height: side }, { background: false, trim: false })!;
    expect(stencil.color[2 * side + 2]).toBe(0xe0e0e0);
    expect(stencil.color[2 * side + 4]).toBe(0xe0e0e0);
  });

  it.each(['none', 'primary'] as const)('retains both eyes through real terrain commands with water role %s', (water: StencilWaterRole) => {
    const side = 7;
    const stencil = stencilFromPixels(face(side, side), { width: side, height: side }, { background: false, trim: false })!;
    const state = makeState(side + 6, side + 6);
    const executor = makeExecutor(state);
    const whole = executor.beginStroke();
    generateTerrain({ state, execute: command => executor.execute(command), reg: executor.getRegistry() }, defaultConfig('stencil', { maxElevation: 8, seed: 1, stencilPlan: { read: 'color', stencil, origin: { x: 3, y: 3 }, water } }));
    expect(whole.commit()).toEqual([]);
    for (const x of [2, 4]) {
      const eye = state.cells[5]![x + 3]!.terrain!;
      const between = state.cells[5]![6]!.terrain!;
      expect(eye.type).toBe(TerrainType.Mountain);
      if (water === 'primary') expect(between.type).toBe(TerrainType.Water);
      else expect(eye.elevation).toBeGreaterThan(between.elevation);
    }
  });
});
