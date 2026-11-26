/** The 3D waterfall arrows scan the meshed map again only when an edit can change its faces. */
import { describe, expect, it } from 'vitest';
import { TerrainType } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { WaterfallArrows } from '../../../../view/map3d/layers/waterfall-arrows';

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

describe('the 3D waterfall arrows', () => {
  it('keeps the 3D arrows through an unrelated edit and redraws them when the fall goes', () => {
    const state = fall();
    const arrows = new WaterfallArrows();
    arrows.flush(state, new Set());
    const mesh = arrows.group.children[0] as unknown as { geometry: { attributes: { position: { count: number } } }; visible: boolean };
    const drawn = mesh.geometry;
    expect(drawn.attributes.position.count).toBe(3);
    setTerrain(state, 15, 15, TerrainType.Mountain, 1);
    arrows.cellsChanged([{ x: 15, y: 15 }], state);
    arrows.flush(state, new Set());
    expect(mesh.geometry).toBe(drawn);
    setTerrain(state, 5, 4, TerrainType.Mountain, 2);
    arrows.cellsChanged([{ x: 5, y: 4 }], state);
    arrows.flush(state, new Set());
    expect(mesh.visible).toBe(false);
    arrows.dispose();
  });

  it('hides the 3D arrows of a hidden layer once the map is scanned anew', () => {
    const state = fall();
    const arrows = new WaterfallArrows();
    arrows.flush(state, new Set());
    arrows.invalidate();
    arrows.flush(state, new Set([2]));
    expect((arrows.group.children[0] as unknown as { visible: boolean }).visible).toBe(false);
    arrows.dispose();
  });
});
