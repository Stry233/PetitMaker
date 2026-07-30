import { describe, it, expect } from 'vitest';
import {
  createGrid,
  getCell,
  setCell,
  isInBounds,
  macroToChunk,
  macroToMicro,
  cloneCell,
  createDefaultTerrainCell,
} from '../../core/model/grid-model';
import { CellZone, TerrainType, type MacroCell, type MapTemplate } from '../../core/model/types';

function makeTestTemplate(width = 4, height = 4): MapTemplate {
  const zones: CellZone[][] = [];
  for (let r = 0; r < height; r++) {
    const row: CellZone[] = [];
    for (let c = 0; c < width; c++) {
      row.push(CellZone.Grass);
    }
    zones.push(row);
  }
  zones[0]![0] = CellZone.Beach;
  return {
    id: 'test',
    name: { en: 'Test', zh: '测试' },
    width,
    height,
    zones,
    plaza: { x: 1, y: 1, width: 2, height: 2, elevation: 2 },
  };
}

describe('createGrid', () => {
  it('creates cells matching template dimensions', () => {
    const template = makeTestTemplate(4, 3);
    const cells = createGrid(template);
    expect(cells.length).toBe(3);
    expect(cells[0]!.length).toBe(4);
  });

  it('assigns zone from template', () => {
    const template = makeTestTemplate();
    const cells = createGrid(template);
    expect(cells[0]![0]!.zone).toBe(CellZone.Beach);
    expect(cells[0]![1]!.zone).toBe(CellZone.Grass);
  });

  it('initializes terrain as null', () => {
    const template = makeTestTemplate();
    const cells = createGrid(template);
    expect(cells[1]![1]!.terrain).toBeNull();
  });
});

describe('getCell / setCell', () => {
  it('returns cell at valid coordinates', () => {
    const template = makeTestTemplate();
    const cells = createGrid(template);
    const cell = getCell(cells, 1, 1);
    expect(cell).not.toBeNull();
    expect(cell!.zone).toBe(CellZone.Grass);
  });

  it('returns null for out-of-bounds coordinates', () => {
    const template = makeTestTemplate();
    const cells = createGrid(template);
    expect(getCell(cells, -1, 0)).toBeNull();
    expect(getCell(cells, 0, 99)).toBeNull();
  });

  it('setCell replaces cell at coordinates', () => {
    const template = makeTestTemplate();
    const cells = createGrid(template);
    const newCell: MacroCell = {
      zone: CellZone.Grass,
      terrain: createDefaultTerrainCell(TerrainType.Mountain, 3),
    };
    setCell(cells, 2, 2, newCell);
    expect(getCell(cells, 2, 2)!.terrain!.elevation).toBe(3);
  });
});

describe('coordinate conversion', () => {
  it('macroToChunk converts correctly', () => {
    expect(macroToChunk(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(macroToChunk(15, 15)).toEqual({ cx: 0, cy: 0 });
    expect(macroToChunk(16, 0)).toEqual({ cx: 1, cy: 0 });
    expect(macroToChunk(31, 31)).toEqual({ cx: 1, cy: 1 });
    expect(macroToChunk(32, 48)).toEqual({ cx: 2, cy: 3 });
  });

  it('macroToMicro maps macro coords to micro coords', () => {
    const micro = macroToMicro(5, 10);
    expect(micro).toEqual({ x: 10, y: 20 });
  });
});

describe('isInBounds', () => {
  it('returns true for valid coordinates', () => {
    expect(isInBounds(3, 3, 4, 4)).toBe(true);
  });
  it('returns false for negative coordinates', () => {
    expect(isInBounds(-1, 0, 4, 4)).toBe(false);
  });
  it('returns false for coordinates at boundary', () => {
    expect(isInBounds(4, 0, 4, 4)).toBe(false);
  });
});

describe('cloneCell', () => {
  it('produces a deep copy', () => {
    const cell: MacroCell = {
      zone: CellZone.Grass,
      terrain: createDefaultTerrainCell(TerrainType.Mountain, 2),
    };
    const copy = cloneCell(cell);
    expect(copy).toEqual(cell);
    expect(copy).not.toBe(cell);
    expect(copy.terrain).not.toBe(cell.terrain);
    copy.terrain!.elevation = 9;
    expect(cell.terrain!.elevation).toBe(2);
  });

  it('preserves corners and patchOnly with reference independence', () => {
    const cell: MacroCell = {
      zone: CellZone.Grass,
      terrain: {
        type: TerrainType.Mountain,
        elevation: 2,
        corners: ['square', 'fan', 'tri-NE', 'empty'],
        patchOnly: true,
      },
    };
    const copy = cloneCell(cell);
    expect(copy.terrain!.corners).toEqual(['square', 'fan', 'tri-NE', 'empty']);
    expect(copy.terrain!.patchOnly).toBe(true);
    // Mutating the clone's corners must not affect the original (no shared reference).
    copy.terrain!.corners![1] = 'square';
    expect(cell.terrain!.corners![1]).toBe('fan');
  });
});
