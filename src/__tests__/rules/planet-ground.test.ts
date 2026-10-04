import { describe, it, expect } from 'vitest';
import { CellZone, TerrainType } from '../../core/model/types';
import { planetGroundRule } from '../../rules/planet-ground';
import { createPlanetRegistry } from '../../rules/index';
import { makeState, paintCmd } from './_helpers';
import { PLANET_PROFILE } from '../../core/model/game-profile';

describe('V-PLANET-01', () => {
  it('refuses ground edits under an object and allows them elsewhere', () => {
    const state = makeState(40, 40);
    state.objects.set('p', { id: 'p', catalogId: '__plaza__', position: { x: 2, y: 2 }, width: PLANET_PROFILE.landmark.width, height: PLANET_PROFILE.landmark.height, rotation: 0, elevation: 1 });
    const under = { ...paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 0), ground: CellZone.Void as const };
    const beside = { ...paintCmd([{ x: 30, y: 5 }], TerrainType.Mountain, 0), ground: CellZone.Void as const };
    expect(planetGroundRule.validate(under, state).map((e) => e.message)).toEqual(['error.ground_under_object']);
    expect(planetGroundRule.validate(beside, state)).toHaveLength(0);
    expect(createPlanetRegistry().validatePreCommand(beside, state)).toHaveLength(0);
  });
});
