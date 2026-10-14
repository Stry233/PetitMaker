import { describe, it, expect } from 'vitest';
import { makeState, setTerrain, makeExecutor } from '../../../../_support/map-state';
import { createDefaultRegistry } from '../../../../../rules/index';
import { getCatalogItem } from '../../../../../state/catalog';
import { objectRect } from '../../../../../state/object-geometry';
import { isCoatingItem } from '../../../../../core/model/traits';
import { TerrainType, type GridState, type PlacedObject } from '../../../../../core/model/types';
import { makeCtx, tryPlace, type PlaceCtx } from '../../../../../tools/placement/object';
import { makeScope } from '../../../../../tools/generation/designer/build/scope';
import { paveFloors } from '../../../../../tools/generation/designer/build/floors';
import { pavableMask, readMap } from '../../../../../tools/reading';

const HOUSE = 'building-myhouse';
/** A plantable surface, which bulk paving otherwise keeps away from anything standing on it. */
const STREET = 'path-rustic-dirt';
const ALWAYS = { share: 1, minFrontage: 0.2 };

interface Town { state: GridState; place: PlaceCtx; house: PlacedObject }

/** A 7x4 house at (6, 6), door north, below a two-wide street on rows 4 and 5 running over
 *  `streetLength` cells from x = `from`. */
function town(streetLength: number, seed = 1, from = 4): Town {
  const state = makeState(30, 30);
  const exec = makeExecutor(state);
  const place = makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), seed);
  for (let x = from; x < from + streetLength; x++) for (const y of [4, 5]) expect(tryPlace(place, STREET, x, y)).not.toBeNull();
  const house = tryPlace(place, HOUSE, 6, 6, 180)!;
  expect(house).not.toBeNull();
  return { state, place, house };
}

const floorTiles = ({ state, house }: Town): PlacedObject[] => {
  const r = objectRect(house);
  return [...state.objects.values()].filter((o) => isCoatingItem(getCatalogItem(o.catalogId))
    && o.position.x >= r.x && o.position.x < r.x + r.w && o.position.y >= r.y && o.position.y < r.y + r.h);
};

const footprintCells = (house: PlacedObject): number => objectRect(house).w * objectRect(house).h;

describe('paved building floors', () => {
  it('carries the street beneath a house that stands along it, in the street\'s material', () => {
    const t = town(12);
    const out = paveFloors(t.place, [t.house], pavableMask(t.state), makeScope(null, 30, 30), ALWAYS);
    expect(out).toEqual({ eligible: 1, paved: 1, tiles: footprintCells(t.house) });
    const tiles = floorTiles(t);
    expect(tiles).toHaveLength(footprintCells(t.house));
    expect(new Set(tiles.map((o) => o.catalogId))).toEqual(new Set([STREET]));
    expect(tiles.every((o) => o.elevation === t.house.elevation)).toBe(true);
    expect(createDefaultRegistry().validatePostStroke(t.state)).toEqual([]);
  });

  it('keeps the ground under a house its street only reaches at the doorstep', () => {
    // The doorstep course meets two of the outline's eighteen edge cells.
    const t = town(2, 1, 8);
    const out = paveFloors(t.place, [t.house], pavableMask(t.state), makeScope(null, 30, 30), ALWAYS);
    expect(out.eligible).toBe(0);
    expect(floorTiles(t)).toHaveLength(0);
  });

  it('paves no floor at share zero, and about the share of many houses', () => {
    const none = town(12);
    expect(paveFloors(none.place, [none.house], pavableMask(none.state), makeScope(null, 30, 30), { ...ALWAYS, share: 0 }).paved).toBe(0);
    let paved = 0;
    for (let seed = 0; seed < 200; seed++) {
      const t = town(12, seed);
      paved += paveFloors(t.place, [t.house], pavableMask(t.state), makeScope(null, 30, 30), { ...ALWAYS, share: 0.75 }).paved;
    }
    expect(paved / 200).toBeGreaterThan(0.65);
    expect(paved / 200).toBeLessThan(0.85);
  });

  it('lays a floor whole or not at all', () => {
    const t = town(12);
    // A rise beside the footprint's last row makes that row's pavement refuse the slope.
    setTerrain(t.state, 9, 10, TerrainType.Mountain, 1);
    const before = t.state.objects.size;
    const out = paveFloors(t.place, [t.house], new Uint8Array(30 * 30).fill(1), makeScope(null, 30, 30), ALWAYS);
    expect(out).toEqual({ eligible: 1, paved: 0, tiles: 0 });
    expect(t.state.objects.size).toBe(before);
    expect(floorTiles(t)).toHaveLength(0);
  });

  it('stays outside a painted region that does not hold the whole building', () => {
    const t = town(12);
    const region = [{ x: 6, y: 6 }, { x: 7, y: 6 }];
    expect(paveFloors(t.place, [t.house], pavableMask(t.state), makeScope(region, 30, 30), ALWAYS).paved).toBe(0);
  });

  it('reads to the evaluator as the building, never as street', () => {
    const t = town(12);
    paveFloors(t.place, [t.house], pavableMask(t.state), makeScope(null, 30, 30), ALWAYS);
    const g = readMap(t.state);
    const i = (t.house.position.y + 1) * 30 + t.house.position.x + 1;
    expect(floorTiles(t).length).toBeGreaterThan(0);
    expect(g.structure[i]).toBe(1);
    expect(g.paved[i]).toBe(0);
    expect(g.paved[5 * 30 + 6]).toBe(1);
  });
});
