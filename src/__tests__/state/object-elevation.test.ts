/**
 * An object that sits on the ground is at the ground's height, whatever it recorded when it landed.
 *
 * `PlacedObject.elevation` is a placement-time cache that nothing re-derives, so any terrain edit
 * under a standing object leaves it stale and the object draws at a height the ground no longer has.
 *
 * A SPANNING object is the exception: a bridge and a ramp are placed across a gap or a step by
 * their own traits, so their elevation is the high end they reach and no cell beneath them holds it.
 */
import { describe, expect, it } from 'vitest';
import { objectElevation } from '../../state/object-geometry';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { makeState, setTerrain } from '../rules/_helpers';
import { CellZone, TerrainType, type GridState, type PlacedObject } from '../../core/model/types';

const SIZE = 20;

function flatMap(): GridState {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) state.cells[y]![x]!.zone = CellZone.Grass;
  return state;
}

function put(state: GridState, catalogId: string, x: number, y: number, elevation = 0): PlacedObject {
  const obj: PlacedObject = { id: `o-${x}-${y}`, catalogId, position: { x, y }, rotation: 0, elevation };
  state.objects.set(obj.id, obj);
  return obj;
}

describe('objectElevation', () => {
  it('follows the ground when the ground moves under it', () => {
    const state = flatMap();
    const road = put(state, 'road-dirt', 5, 5);
    expect(objectElevation(state, road)).toBe(0);

    setTerrain(state, 5, 5, TerrainType.Mountain, 2);

    expect(objectElevation(state, road), 'the road is on the bench now').toBe(2);
    expect(road.elevation, 'and the stored number is still the stale one it was placed with').toBe(0);
  });

  it('agrees with the terrain kernel, which is the one answer to what a surface is', () => {
    const state = flatMap();
    for (let tier = 1; tier <= 3; tier++) setTerrain(state, 8, tier + 4, TerrainType.Mountain, tier);
    for (let tier = 1; tier <= 3; tier++) {
      const o = put(state, 'road-dirt', 8, tier + 4);
      expect(objectElevation(state, o)).toBe(surfaceElevation(state.cells[tier + 4]![8]!.terrain));
    }
  });

  it('leaves a spanning crossing on the height it reaches', () => {
    // A ramp climbs from the ground to tier 2 and is stored at its high end. The cell under its
    // anchor is the LOW one, so deriving from the ground would drop it to the foot of its own slope.
    const state = flatMap();
    const ramp = put(state, 'ramp-park-steps', 6, 6, 2);
    expect(objectElevation(state, ramp)).toBe(2);

    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    expect(objectElevation(state, ramp), 'still its own span, not the ground it starts from').toBe(2);
  });

  it('a building carried up by a raise stands on the raise', () => {
    const state = flatMap();
    const house = put(state, 'building-myhouse', 10, 10);
    for (let y = 9; y <= 13; y++) for (let x = 9; x <= 13; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    expect(objectElevation(state, house)).toBe(1);
  });
});
