import { describe, it, expect } from 'vitest';
import { createGrid, getCell, setCell, cloneCell, createDefaultTerrainCell, sameTerrain, clearsTerrain, CLEARING_ELEVATION } from '../../../core/model/grid-model';
import { eraseTerrainCommand, paintTerrainCommand } from '../../../core/model/command-build';
import { isInBounds, cellOverlapsRect } from '../../../core/grid/rect';
import { bucketOf } from '../../../core/grid/buckets';
import { TerrainType, type MacroCell, type MapTemplate, type TerrainCell } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { ANCHOR_LANDMARK } from '../../_support/anchor';

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
    landmarks: [{ id: ANCHOR_LANDMARK.id, x: 1, y: 1, width: 2, height: 2 }],
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
  it('bucketOf converts correctly', () => {
    expect(bucketOf(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(bucketOf(15, 15)).toEqual({ cx: 0, cy: 0 });
    expect(bucketOf(16, 0)).toEqual({ cx: 1, cy: 0 });
    expect(bucketOf(31, 31)).toEqual({ cx: 1, cy: 1 });
    expect(bucketOf(32, 48)).toEqual({ cx: 2, cy: 3 });
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

describe('cellOverlapsRect', () => {
  // A footprint with half-cell edges, as the plaza has: world x from `LEFT` to `RIGHT`.
  const LEFT = 10.5, RIGHT = 30.5, ROW = 24;
  const rect = { x: LEFT, y: 10.5, w: RIGHT - LEFT, h: 27 };

  it('reads a terrain cell (shift -0.5) as touching just outside each edge and overlapping just inside', () => {
    expect(cellOverlapsRect(rect, LEFT - 0.5, ROW, 'terrain')).toBe(false);
    expect(cellOverlapsRect(rect, LEFT + 0.5, ROW, 'terrain')).toBe(true);
    expect(cellOverlapsRect(rect, RIGHT - 0.5, ROW, 'terrain')).toBe(true);
    expect(cellOverlapsRect(rect, RIGHT + 0.5, ROW, 'terrain')).toBe(false);
  });

  it('reads an object cell (shift 0) as overlapping from half a cell before the edge', () => {
    expect(cellOverlapsRect(rect, LEFT - 0.5, ROW, 'object')).toBe(true);
    expect(cellOverlapsRect(rect, LEFT - 1.5, ROW, 'object')).toBe(false);
  });
});

describe('sameTerrain', () => {
  const m = (patch: Partial<TerrainCell> = {}): TerrainCell => ({ type: TerrainType.Mountain, elevation: 2, ...patch });
  const exact = { patchOnly: 'exact' } as const, flag = { patchOnly: 'flag' } as const;

  it('compares type, elevation, patch base and corners', () => {
    expect(sameTerrain(m(), m(), exact)).toBe(true);
    expect(sameTerrain(m(), m({ elevation: 3 }), exact)).toBe(false);
    expect(sameTerrain(m(), { type: TerrainType.Water, elevation: 2 }, exact)).toBe(false);
    expect(sameTerrain(m({ patchBase: 1 }), m(), flag)).toBe(false);
    expect(sameTerrain(m({ corners: ['fan', 'square', 'square', 'square'] }), m({ corners: ['fan', 'square', 'square', 'square'] }), exact)).toBe(true);
    expect(sameTerrain(m({ corners: ['fan', 'square', 'square', 'square'] }), m({ corners: ['square', 'square', 'square', 'square'] }), exact)).toBe(false);
    expect(sameTerrain(m({ corners: ['square', 'square', 'square', 'square'] }), m(), exact)).toBe(false);
  });

  it('reads an absent patch flag apart from false only when exact', () => {
    expect(sameTerrain(m({ patchOnly: false }), m(), exact)).toBe(false);
    expect(sameTerrain(m({ patchOnly: false }), m(), flag)).toBe(true);
    expect(sameTerrain(m({ patchOnly: true }), m(), flag)).toBe(false);
  });

  it('matches empty cells only to the same emptiness', () => {
    expect(sameTerrain(null, null, flag)).toBe(true);
    expect(sameTerrain(undefined, undefined, exact)).toBe(true);
    expect(sameTerrain(null, undefined, exact)).toBe(false);
    expect(sameTerrain(null, m(), flag)).toBe(false);
  });
});

describe('clearsTerrain', () => {
  const at = [{ x: 1, y: 1 }];
  it('holds for an erase and a mountain paint at the clearing elevation, and nothing else', () => {
    expect(clearsTerrain(eraseTerrainCommand(at))).toBe(true);
    expect(clearsTerrain(paintTerrainCommand(at, TerrainType.Mountain, CLEARING_ELEVATION))).toBe(true);
    expect(clearsTerrain(paintTerrainCommand(at, TerrainType.Mountain, CLEARING_ELEVATION + 1))).toBe(false);
    expect(clearsTerrain(paintTerrainCommand(at, TerrainType.Water, CLEARING_ELEVATION))).toBe(false);
  });
});
