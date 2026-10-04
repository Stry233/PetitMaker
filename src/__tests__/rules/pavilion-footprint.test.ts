import { describe, expect, it } from 'vitest';
import { TerrainType } from '../../core/model/types';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getCatalogItem } from '../../state/catalog';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { traitPlacementRule } from '../../rules/placement';
import { makeObject, makeState, placeCmd, setTerrain } from './_helpers';

describe('Omni-Gallery exclusion footprint', () => {
  it.each([0, 90, 180, 270] as const)('reserves the full game footprint at %s degrees', rotation => {
    const pavilion = makeObject('facility-pavilion', 4, 4, rotation);
    const { w, h } = getPlacedObjectSize(pavilion);
    const item = getCatalogItem('facility-pavilion')!;
    expect([w, h]).toEqual(rotation % 180 === 0 ? [item.width, item.height] : [item.height, item.width]);
    const state = makeState(24, 24);
    state.objects.set(pavilion.id, pavilion);
    for (const [x, y] of [[4 + w - 1, 4], [4, 4 + h - 1]]) {
      expect(placementOverlapRule.validate(placeCmd(makeObject('flower-rose', x!, y!)), state)).toHaveLength(1);
    }
    for (const [x, y] of [[4 + w, 4], [4, 4 + h]]) {
      expect(placementOverlapRule.validate(placeCmd(makeObject('flower-rose', x!, y!)), state)).toHaveLength(0);
    }
    const terrain = makeState(24, 24);
    expect(traitPlacementRule.validate(placeCmd(pavilion), terrain)).toHaveLength(0);
    setTerrain(terrain, 4 + w - 1, 4 + h - 1, TerrainType.Water, 0);
    expect(traitPlacementRule.validate(placeCmd(pavilion), terrain)).toHaveLength(1);
  });
});
