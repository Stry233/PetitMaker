import { describe, it, expect } from 'vitest';
import { terrainSolidAt } from '../../../../core/domain/terrain/terrain-surface';
import { TerrainType } from '../../../../core/model/types';
import type { TerrainCell } from '../../../../core/model/types';

const M = TerrainType.Mountain, W = TerrainType.Water;
const cell = (type: TerrainType, elevation: number, patchOnly?: boolean): TerrainCell => ({ type, elevation, ...(patchOnly ? { patchOnly } : {}) });

describe('terrainSolidAt — a cell at elevation N is a stack of layers', () => {
  it('mountain at N fills layers 1..N (not 0, not N+1)', () => {
    expect(terrainSolidAt(cell(M, 3), M, 1)).toBe(true);
    expect(terrainSolidAt(cell(M, 3), M, 3)).toBe(true);
    expect(terrainSolidAt(cell(M, 3), M, 0)).toBe(false);
    expect(terrainSolidAt(cell(M, 3), M, 4)).toBe(false);
  });

  it('water at N fills 0..N (a lake sits at ground level; a waterfall is a column)', () => {
    expect(terrainSolidAt(cell(W, 0), W, 0)).toBe(true);
    expect(terrainSolidAt(cell(W, 2), W, 0)).toBe(true);
    expect(terrainSolidAt(cell(W, 2), W, 2)).toBe(true);
    expect(terrainSolidAt(cell(W, 2), W, 3)).toBe(false);
  });

  it('type-filtered: mountain mass is not water mass', () => {
    expect(terrainSolidAt(cell(M, 3), W, 1)).toBe(false);
  });

  it('a Γ patch is a fillet ON a base: solid up to N-1, nothing at its fillet tier', () => {
    expect(terrainSolidAt(cell(M, 3, true), M, 1)).toBe(true);
    expect(terrainSolidAt(cell(M, 3, true), M, 2)).toBe(true);
    expect(terrainSolidAt(cell(M, 3, true), M, 3), 'the fillet tier itself is not mass').toBe(false);
    expect(terrainSolidAt(cell(M, 1, true), M, 1), 'a tier-1 fillet has no base').toBe(false);
  });

  it('null/None is never solid', () => {
    expect(terrainSolidAt(null, M, 1)).toBe(false);
    expect(terrainSolidAt(cell(TerrainType.None, 0), M, 1)).toBe(false);
  });
});
