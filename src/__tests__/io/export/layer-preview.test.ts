import { describe, it, expect } from 'vitest';
import { layersFor } from '../../../io/export/layer-preview';
import { CellZone, TerrainType, type GridState, type MacroCell } from '../../../core/model/types';

/** Build a tiny GridState whose cells carry the given (type, elevation) so we can probe the
 *  construction-step derivation directly. `peaks` is a flat list painted onto a 4x3 grass grid. */
function makeState(peaks: { type: TerrainType; elevation: number }[]): GridState {
  const width = 4, height = 3;
  const cells: MacroCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: MacroCell[] = [];
    for (let x = 0; x < width; x++) row.push({ zone: CellZone.Grass, terrain: null });
    cells.push(row);
  }
  // Drop the peaks onto the first cells, row-major.
  let i = 0;
  for (const p of peaks) {
    const y = Math.floor(i / width), x = i % width;
    if (cells[y]?.[x]) cells[y]![x] = { zone: CellZone.Grass, terrain: { type: p.type, elevation: p.elevation } };
    i++;
  }
  return {
    template: { id: 't', name: { en: 't' }, width, height, zones: [], plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 } },
    cells,
    objects: new Map(),
    lockedLayers: new Set(),
  };
}

describe('layersFor (construction sequence)', () => {
  it('all-ground map → a single ground step', () => {
    const steps = layersFor(makeState([]));
    expect(steps).toEqual([{ level: 0, labelKey: 'export.layer_ground' }]);
  });

  it('max mountain elevation 3 → 4 steps, level 0..3', () => {
    const steps = layersFor(makeState([
      { type: TerrainType.Mountain, elevation: 1 },
      { type: TerrainType.Mountain, elevation: 3 },
      { type: TerrainType.Mountain, elevation: 2 },
    ]));
    expect(steps.map((s) => s.level)).toEqual([0, 1, 2, 3]);
    expect(steps[0]!.labelKey).toBe('export.layer_ground');
    expect(steps[1]!.labelKey).toBe('export.layer_level');
    expect(steps[3]!.labelKey).toBe('export.layer_level');
  });

  it('water elevation also drives the max level', () => {
    const steps = layersFor(makeState([{ type: TerrainType.Water, elevation: 2 }]));
    expect(steps.map((s) => s.level)).toEqual([0, 1, 2]);
  });

  it('caps at ELEVATION_MAX (8) even if a cell somehow exceeds it', () => {
    const steps = layersFor(makeState([{ type: TerrainType.Mountain, elevation: 20 }]));
    expect(steps[steps.length - 1]!.level).toBe(8);
    expect(steps).toHaveLength(9); // levels 0..8
  });
});
