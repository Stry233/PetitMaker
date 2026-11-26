/** Both views draw one arrow per waterfall face, pointing downstream, and scan the faces again only when an edit can change them. */
import { describe, expect, it } from 'vitest';
import { TerrainType } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { WaterfallFaceWatch, waterfallArrowTriangles, type WaterfallFaces } from '../../../../view/shared/terrain/waterfall-arrows';

/** A pool at layer 2 walled by mountain to the west, north and east, open ground to the south: one face
 *  flowing south from (5, 4). */
function fall() {
  const state = makeState(20, 20);
  setTerrain(state, 5, 3, TerrainType.Mountain, 2);
  setTerrain(state, 4, 4, TerrainType.Mountain, 2);
  setTerrain(state, 5, 4, TerrainType.Water, 2);
  setTerrain(state, 6, 4, TerrainType.Mountain, 2);
  return state;
}

describe('waterfall arrows', () => {
  it('points each arrow downstream inside its cell, apart from its neighbour on a cell with two faces', () => {
    const faces: WaterfallFaces = new Map([['3,7', ['south', 'east']]]);
    const [south, east] = waterfallArrowTriangles(faces);
    for (const arrow of [south!, east!]) {
      const xs = [arrow.points[0], arrow.points[2], arrow.points[4]];
      const ys = [arrow.points[1], arrow.points[3], arrow.points[5]];
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...xs)).toBeLessThanOrEqual(4);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(7);
      expect(Math.max(...ys)).toBeLessThanOrEqual(8);
    }
    // The tip leads: furthest along the flow of the three corners.
    expect(south!.points[1]).toBeGreaterThan(Math.max(south!.points[3], south!.points[5]));
    expect(east!.points[0]).toBeGreaterThan(Math.max(east!.points[2], east!.points[4]));
    expect(south!.points[1]).toBeGreaterThan(7.5);
    expect(east!.points[0]).toBeGreaterThan(3.5);
  });

  it('leaves out the cells a view hides', () => {
    const faces: WaterfallFaces = new Map([['1,1', ['north']], ['2,2', ['west']]]);
    expect(waterfallArrowTriangles(faces, (x) => x !== 1).map((a) => a.cell)).toEqual([{ x: 2, y: 2 }]);
  });

  it('asks for a scan only when an edit reaches a face or the water beside one', () => {
    const state = fall();
    const watch = new WaterfallFaceWatch();
    expect([...watch.scan(state)]).toEqual([['5,4', ['south']]]);
    expect(watch.touchedBy([{ x: 15, y: 15 }], state)).toBe(false);
    expect(watch.touchedBy([{ x: 5, y: 5 }], state)).toBe(true);
    // Erasing the pool leaves no water to depend on; the cell carried a face at the last scan.
    setTerrain(state, 5, 4, TerrainType.Mountain, 2);
    expect(watch.touchedBy([{ x: 5, y: 4 }], state)).toBe(true);
  });
});
