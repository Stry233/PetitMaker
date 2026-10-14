import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../core/model/types';
import { layerRows } from '../../state/layer-utils';
import { makeState, setTerrain } from '../_support/map-state';

describe('layerRows', () => {
  it('layer 1 count stays when fully covered by layer 2', () => {
    const state = makeState(10, 10);
    // 3x3 at elevation 2 — each cell occupies layers 1 and 2
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const layers = layerRows(state, 1);
    const l1 = layers.find(l => l.elevation === 1);
    const l2 = layers.find(l => l.elevation === 2);

    expect(l1?.count).toBe(9);
    expect(l2?.count).toBe(9);
  });

  it('stacking layers 1-4 shows correct counts at each layer', () => {
    const state = makeState(10, 10);
    // 3x3 at elev 1, then center column at elev 4
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);

    const layers = layerRows(state, 1);
    expect(layers.find(l => l.elevation === 1)?.count).toBe(9);
    expect(layers.find(l => l.elevation === 2)?.count).toBe(1);
    expect(layers.find(l => l.elevation === 3)?.count).toBe(1);
    expect(layers.find(l => l.elevation === 4)?.count).toBe(1);
  });

  // Adding an empty layer (selecting a layer above any terrain) must not drop the
  // empty intermediate layers — the list is contiguous Ground..top.
  it('keeps empty intermediate layers when a higher layer is active', () => {
    const state = makeState(10, 10); // no terrain at all
    const layers = layerRows(state, 3); // active layer 3 (e.g. after +,+,+)
    expect(layers.map(l => l.elevation)).toEqual([0, 1, 2, 3]); // contiguous, no gaps
    // Every layer 1..3 is present even though empty (count 0).
    expect(layers.find(l => l.elevation === 2)?.count).toBe(0);
  });

  it('shows the full contiguous range up to the highest of active-layer or terrain', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 5); // terrain reaches layer 5
    const layers = layerRows(state, 2); // a lower layer is selected
    expect(layers.map(l => l.elevation)).toEqual([0, 1, 2, 3, 4, 5]); // terrain still listed
  });
});
