import { describe, it, expect } from 'vitest';
import { analyzeTerrain, distanceField } from '../../../tools/placement/analysis';
import { makeState } from '../../rules/_helpers';
import { TerrainType } from '../../../core/model/types';

describe('placement/analysis', () => {
  it('distanceField is 0 at seeds, grows by BFS', () => {
    expect(Array.from(distanceField([0], 5, 1))).toEqual([0, 1, 2, 3, 4]);
  });
  it('analyzeTerrain: one big open region + distance to a water cell', () => {
    const state = makeState(12, 12);
    state.cells[6]![6]!.terrain = { type: TerrainType.Water, elevation: 0 };
    const a = analyzeTerrain(state);
    expect(a.regionCells[a.rankedRegions[0]!]!.length).toBeGreaterThan(120);
    expect(a.distToWater[6 * 12 + 6]).toBe(0);
    expect(a.distToWater[0]).toBeGreaterThan(5);
  });
  it('a flat elevated plateau is buildable and a distinct region from the ground', () => {
    const state = makeState(20, 20);
    // a 6x6 mountain plateau at tier 2 in the interior
    for (let y = 6; y < 12; y++) for (let x = 6; x < 12; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const a = analyzeTerrain(state);
    const plateauInterior = 8 * 20 + 8; // well inside the plateau
    expect(a.open[plateauInterior]).toBe(1);          // elevated flats are buildable now
    expect(a.elev[plateauInterior]).toBe(2);
    const groundCell = 1 * 20 + 1;                    // tier-0 ground corner
    expect(a.open[groundCell]).toBe(1);
    expect(a.region[plateauInterior]).not.toBe(a.region[groundCell]); // different regions
    expect(a.regionElev[a.region[plateauInterior]!]).toBe(2);
    expect(a.regionElev[a.region[groundCell]!]).toBe(0);
  });
});
