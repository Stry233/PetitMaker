/**
 * Object elevation labels must honour the same zoom LOD as the terrain number raster: below
 * MIN_NUMBER_ZOOM they'd be an illegible blur, so they hide. Guards against the labels tracking only
 * the show-layer-numbers toggle and staying visible at ANY zoom, including for a placement made
 * while zoomed far out.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { ObjectLayer } from '../../canvas/map2d/layers/object-layer';
import { MIN_NUMBER_ZOOM } from '../../canvas/map2d/layers/number-overlay';
import { type PlacedObject } from '../../core/model/types';
import { getCatalogItem, registerCatalogItem } from '../../state/catalog';

// A 2x2 sprite building carries an `_elev` elevation label (the general placement label path).
const house = getCatalogItem('building-myhouse')!;
registerCatalogItem({ ...house, id: 'test-lod-house', width: 2, height: 2 });

const place = (id: string): PlacedObject =>
  ({ id, catalogId: 'test-lod-house', position: { x: 2, y: 2 }, rotation: 0, elevation: 3 });

interface Child { name: string; visible: boolean }
function elevLabel(layer: ObjectLayer, id: string): Child | undefined {
  const map = (layer as unknown as { objectMap: Map<string, { children: Child[] }> }).objectMap;
  return map.get(id)?.children.find((c) => c.name === '_elev');
}

const bigRect = { left: 0, top: 0, right: 10000, bottom: 10000 };

describe('object elevation labels honour the number-overlay zoom LOD', () => {
  it('track the toggle AND the zoom threshold', () => {
    const layer = new ObjectLayer();
    layer.cull(bigRect);          // establish a visible bucket so labels build
    layer.setNumberZoom(1);       // zoomed in
    layer.addObjects([place('h')]);
    layer.setShowNumbers(true);
    expect(elevLabel(layer, 'h')?.visible).toBe(true);

    layer.setNumberZoom(MIN_NUMBER_ZOOM - 0.05); // zoom out below the LOD → hide
    expect(elevLabel(layer, 'h')?.visible).toBe(false);

    layer.setNumberZoom(MIN_NUMBER_ZOOM);        // back at the threshold → show
    expect(elevLabel(layer, 'h')?.visible).toBe(true);

    layer.setShowNumbers(false);                 // toggled off → hide regardless of zoom
    expect(elevLabel(layer, 'h')?.visible).toBe(false);
  });

  it('an object PLACED while zoomed out below the LOD does not show its label', () => {
    const layer = new ObjectLayer();
    layer.cull(bigRect);
    layer.setShowNumbers(true);
    layer.setNumberZoom(MIN_NUMBER_ZOOM - 0.05);       // zoomed out
    layer.addObjects([place('h2')]);
    expect(elevLabel(layer, 'h2'), 'label not built/shown below LOD').toBeUndefined();

    layer.setNumberZoom(1);                            // zoom in → builds + shows
    expect(elevLabel(layer, 'h2')?.visible).toBe(true);
  });
});
