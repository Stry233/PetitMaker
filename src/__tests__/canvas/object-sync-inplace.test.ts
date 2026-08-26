/**
 * `ObjectLayer.sync` is the reconcile every bulk caller runs after committing (Generate, Clear, a
 * macro press, via MapRenderer.resyncObjects). Comparing only WHICH IDS EXIST leaves it blind to the
 * one drift most likely to happen: a road's corner cut edits its object IN PLACE — same id, new
 * corners/rotation/patchOnly (see core/commands/command-apply.ts, the `layer === 'road'` branch) — so
 * the id set matches state while the stale sprite stays on the map, making the reconcile weaker than
 * the per-object events it exists to back up.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { ObjectLayer } from '../../canvas/map2d/layers/object-layer';
import type { Corners, PlacedObject } from '../../core/model/types';
import { registerCatalogItem, getCatalogItem } from '../../state/catalog';

const house = getCatalogItem('building-myhouse')!;
registerCatalogItem({ ...house, id: 'sync-item', width: 1, height: 1 });

const obj = (over: Partial<PlacedObject> = {}): PlacedObject => ({
  id: 'o1', catalogId: 'sync-item', position: { x: 4, y: 4 }, rotation: 0, elevation: 0, ...over,
});

/** The wrapper currently drawn for an id — a redraw replaces it, so identity is the observable. */
const wrapperOf = (layer: ObjectLayer, id: string): unknown =>
  (layer as unknown as { objectMap: Map<string, unknown> }).objectMap.get(id);

describe('ObjectLayer.sync reconciles objects edited in place', () => {
  it('redraws an object whose corners changed under the same id', () => {
    const layer = new ObjectLayer();
    layer.addObjects([obj()]);
    const before = wrapperOf(layer, 'o1');
    expect(before).toBeDefined();

    // Exactly what a road corner-cut does: same id, new corners.
    const cut = obj({ corners: ['fan', 'square', 'square', 'square'] as Corners });
    layer.sync(new Map([['o1', cut]]));

    expect(wrapperOf(layer, 'o1')).not.toBe(before); // rebuilt, not left standing
  });

  it('redraws on a rotation change, and leaves an untouched object alone', () => {
    const layer = new ObjectLayer();
    layer.addObjects([obj(), obj({ id: 'o2', position: { x: 9, y: 9 } })]);
    const before1 = wrapperOf(layer, 'o1');
    const before2 = wrapperOf(layer, 'o2');

    layer.sync(new Map([
      ['o1', obj({ rotation: 90 })],
      ['o2', obj({ id: 'o2', position: { x: 9, y: 9 } })],
    ]));

    expect(wrapperOf(layer, 'o1')).not.toBe(before1); // rotation is part of the drawing
    expect(wrapperOf(layer, 'o2')).toBe(before2);     // unchanged: no needless churn
  });

  it('still adds what is missing and drops what is gone', () => {
    const layer = new ObjectLayer();
    layer.addObjects([obj()]);
    layer.sync(new Map([['o2', obj({ id: 'o2', position: { x: 2, y: 2 } })]]));

    expect(wrapperOf(layer, 'o1')).toBeUndefined();
    expect(wrapperOf(layer, 'o2')).toBeDefined();
  });
});
