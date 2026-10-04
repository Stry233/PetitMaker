import { expect, it } from 'vitest';
import { TerrainType } from '../../core/model/types';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { traitPlacementRule } from '../../rules/placement';
import { deserialize, serialize } from '../../io/json-codec';
import { makeObject, makeState, placeCmd, setTerrain } from './_helpers';

it.each([0, 90, 180, 270] as const)('reserves Yunguo’s fifth row and column at %s degrees', rotation => {
  const house = makeObject('building-bamboo-cabin', 4, 4, rotation);
  expect(getPlacedObjectSize(house)).toEqual({ w: 5, h: 5 });
  const state = makeState(24, 24);
  state.objects.set(house.id, house);
  for (const [x, y] of [[8, 4], [4, 8], [8, 8]]) {
    expect(placementOverlapRule.validate(placeCmd(makeObject('flower-rose', x!, y!)), state)).toHaveLength(1);
  }
  for (const [x, y] of [[9, 4], [4, 9]]) {
    expect(placementOverlapRule.validate(placeCmd(makeObject('flower-rose', x!, y!)), state)).toHaveLength(0);
  }
  const restored = deserialize(serialize(state), state.template);
  expect(restored.objects.get(house.id)).toEqual(house);
  expect(getPlacedObjectSize(restored.objects.get(house.id)!)).toEqual({ w: 5, h: 5 });
  const terrain = makeState(24, 24);
  expect(traitPlacementRule.validate(placeCmd(house), terrain)).toHaveLength(0);
  setTerrain(terrain, 8, 8, TerrainType.Water, 0);
  expect(traitPlacementRule.validate(placeCmd(house), terrain)).toHaveLength(1);
});
