import { describe, expect, it } from 'vitest';
import { buildSeaFrame } from '../../../../view/map3d/geometry/terrain-geometry';
import { SEA_Y } from '../../../../view/map3d/geometry/coords';
import type { MeshData } from '../../../../view/map3d/geometry/types';
import { getMapTemplate } from '../../../../config/maps';
import { createGrid } from '../../../../core/model/grid-model';
import { mapFrame } from '../../../../core/grid/map-chunks';
import { makeState } from '../../../_support/map-state';

function horizontalArea(mesh: MeshData, height: number): number {
  let area = 0;
  for (let i = 0; i < mesh.index.length; i += 3) {
    const points = mesh.index.slice(i, i + 3).map((index) => mesh.positions.slice(index * 3, index * 3 + 3));
    if (points.some((p) => p[1] !== height)) continue;
    const [a, b, c] = points as [number[], number[], number[]];
    area += Math.abs((b[0]! - a[0]!) * (c[2]! - a[2]!) - (c[0]! - a[0]!) * (b[2]! - a[2]!)) / 2;
  }
  return area;
}

describe('sea frame', () => {
  it.each(['hexia', 'tafa'])('keeps the fading sea inside %s reference bounds without vertical walls', (id) => {
    const template = getMapTemplate(id);
    const state = { ...makeState(), template, cells: createGrid(template) };
    const { ground, water } = buildSeaFrame(state);
    const frame = mapFrame(template);
    expect(horizontalArea(water, SEA_Y)).toBe(frame.width * frame.height - 169 * 140);
    expect(ground.positions).toHaveLength(4 * 4 * 3);
    expect(water.positions.filter((_, i) => i % 3 === 1).every((y) => y === SEA_Y)).toBe(true);
    const xs = water.positions.filter((_, i) => i % 3 === 0);
    const zs = water.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBe(frame.x - template.width / 2);
    expect(Math.max(...xs)).toBe(frame.x + frame.width - template.width / 2);
    expect(Math.min(...zs)).toBe(frame.y - template.height / 2);
    expect(Math.max(...zs)).toBe(frame.y + frame.height - template.height / 2);
  });

  it('adds no sea to a template without an extended frame', () => {
    expect(buildSeaFrame(makeState()).water.positions).toEqual([]);
    expect(buildSeaFrame(makeState()).ground.positions).toEqual([]);
  });
});
