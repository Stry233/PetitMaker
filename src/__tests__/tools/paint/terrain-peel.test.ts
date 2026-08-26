import { describe, it, expect } from 'vitest';
import { peelCommand } from '../../../tools/paint/terrain-peel';
import { CommandType, TerrainType, type MacroCell } from '../../../core/model/types';

function mtn(elev: number): MacroCell { return { zone: 2, terrain: { type: TerrainType.Mountain, elevation: elev } }; }
function water(elev: number): MacroCell { return { zone: 2, terrain: { type: TerrainType.Water, elevation: elev } }; }
const ground: MacroCell = { zone: 2, terrain: null };

describe('peelCommand', () => {
  it('mountain 3 → PaintTerrain at elevation 2', () => {
    const cmd = peelCommand(4, 5, mtn(3));
    expect(cmd?.type).toBe(CommandType.PaintTerrain);
    expect((cmd as any).elevation).toBe(2);
    expect((cmd as any).terrainType).toBe(TerrainType.Mountain);
    expect((cmd as any).cells).toEqual([{ x: 4, y: 5 }]);
  });
  it('mountain 1 → PaintTerrain at elevation 0 (clears to ground)', () => {
    const cmd = peelCommand(4, 5, mtn(1));
    expect(cmd?.type).toBe(CommandType.PaintTerrain);
    expect((cmd as any).elevation).toBe(0);
  });
  it('water → EraseTerrain (clears to ground)', () => {
    const cmd = peelCommand(4, 5, water(2));
    expect(cmd?.type).toBe(CommandType.EraseTerrain);
    expect((cmd as any).cells).toEqual([{ x: 4, y: 5 }]);
  });
  it('ground (terrain null) → null', () => {
    expect(peelCommand(4, 5, ground)).toBeNull();
  });
  it('null cell → null', () => {
    expect(peelCommand(4, 5, null)).toBeNull();
  });
});
