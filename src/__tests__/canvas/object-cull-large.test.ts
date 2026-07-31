/**
 * Chunk culling buckets an object by its ANCHOR cell, with an 8-tile overscan
 * margin for spill. An object larger than that margin (the central plaza is
 * 20×27) can have its anchor chunk fully outside the padded view while most of
 * its body is still on screen — zooming in near a plaza corner made the whole
 * plaza vanish. Oversized objects therefore bypass the buckets and sit directly
 * in their per-elevation container: still layer-faded, never culled.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { ObjectLayer } from '../../canvas/map2d/layers/object-layer';
import { CULL_MARGIN_PX } from '../../canvas/map2d/layers/chunk-cull';
import { TILE_SIZE } from '../../core/model/constants';
import { type PlacedObject } from '../../core/model/types';
import { registerCatalogItem, getCatalogItem } from '../../state/catalog';

const house = getCatalogItem('building-myhouse')!;
registerCatalogItem({ ...house, id: 'test-giant', width: 20, height: 27 });
registerCatalogItem({ ...house, id: 'test-small', width: 2, height: 2 });

const place = (id: string, catalogId: string): PlacedObject =>
  ({ id, catalogId, position: { x: 76, y: 58 }, rotation: 0, elevation: 0 });

describe('object culling vs oversized footprints', () => {
  it('an object larger than the cull margin stays visible when its anchor chunk is culled', () => {
    expect(20 * TILE_SIZE).toBeGreaterThan(CULL_MARGIN_PX); // the premise
    const layer = new ObjectLayer();
    layer.addObjects([place('giant', 'test-giant'), place('small', 'test-small')]);
    // Camera over the giant's FAR corner (cells ~94..100): the anchor cell (76,58)
    // and its chunk sit outside the padded rect, but the body is on screen.
    layer.cull({ left: 94 * TILE_SIZE, top: 80 * TILE_SIZE, right: 100 * TILE_SIZE, bottom: 88 * TILE_SIZE });
    const wrappers = (layer as unknown as { objectMap: Map<string, { worldVisible: boolean; parent: unknown }> }).objectMap;
    expect(wrappers.get('small')!.worldVisible, 'anchor-bucketed control culls away').toBe(false);
    expect(wrappers.get('giant')!.worldVisible, 'oversized object must not cull').toBe(true);
  });
});
