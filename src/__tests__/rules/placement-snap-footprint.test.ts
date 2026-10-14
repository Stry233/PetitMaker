import { describe, expect, it } from 'vitest';
import { CommandType, TerrainType, type PlaceObjectCommand } from '../../core/model/types';
import { traitPlacementRule } from '../../rules/placement';
import { __setCatalogItem, getCatalogItem } from '../../state/catalog';
import { makeState, setTerrain } from '../_support/map-state';

const ramp = getCatalogItem('ramp-plank')!;
__setCatalogItem({ ...ramp, id: 'test-ramp-coated', traits: [...ramp.traits, { type: 'surfaceCoating' }] });

describe('V-PLACE-TRAIT: traits after a snapping trait', () => {
  it('judge the footprint the snap produced, not the one at the press', () => {
    // A layer-1 plateau over x <= 9 and one water cell at (10, 6): the press's upright footprint
    // covers the water, and the ramp it snaps to turns across the cliff and clears it.
    const state = makeState(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x <= 9; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    setTerrain(state, 10, 6, TerrainType.Water, 0);
    const cmd = traitPlacementRule.resolve!({
      type: CommandType.PlaceObject,
      object: { id: 'ramp', catalogId: 'test-ramp-coated', position: { x: 10, y: 4.5 }, rotation: 0, elevation: 0 },
    }, state) as PlaceObjectCommand;
    expect(traitPlacementRule.validate(cmd, state)).toEqual([]);
    expect(cmd.object.rotation).toBe(90);
  });
});
