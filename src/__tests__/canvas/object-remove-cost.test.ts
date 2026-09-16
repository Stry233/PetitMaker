/**
 * `ObjectLayer.removeObjects` must cost the removal, not the map. A road corner-trim's remove+add
 * pairs drive it several times per brush dab, so a `this.lodSprites.filter(...)` tail — a full pass
 * over every sprite-bearing decoration on the map, every call, whatever the ids being removed
 * actually are — makes every dab of a road stroke heavier as the map fills up, on a session that has
 * accumulated thousands of decorations. `lodSprites` is keyed by object id, so a removal drops its
 * own entry directly.
 *
 * Pinned by counting (never timing, per this repo's convention for growth bugs): the number of times
 * the WHOLE lodSprites collection is walked while removing objects one (or a few) at a time must stay
 * at zero, however many decorations sit on the map.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { ObjectLayer } from '../../canvas/map2d/layers/object-layer';
import { type PlacedObject } from '../../core/model/types';
import { getCatalogItem, registerCatalogItem } from '../../state/catalog';

const house = getCatalogItem('building-myhouse')!;
registerCatalogItem({ ...house, id: 'test-remove-cost', width: 1, height: 1 });

const place = (id: string, i: number): PlacedObject =>
  ({ id, catalogId: 'test-remove-cost', position: { x: i % 90, y: Math.floor(i / 90) }, rotation: 0, elevation: 0 });

/** The layer's id-to-sprite LOD map with every full-iteration entry point instrumented for cost assertions. */
function instrumentLodMap(layer: ObjectLayer): { map: Map<string, unknown>; walks: () => number } {
  const map = (layer as unknown as { lodSprites: Map<string, unknown> }).lodSprites;
  let walks = 0;
  const count = <A extends unknown[], R>(fn: (...args: A) => R) =>
    function (this: Map<string, unknown>, ...args: A): R { walks++; return fn(...args); };
  map[Symbol.iterator] = count(map[Symbol.iterator].bind(map));
  map.values = count(map.values.bind(map));
  map.keys = count(map.keys.bind(map));
  map.entries = count(map.entries.bind(map));
  map.forEach = count(map.forEach.bind(map));
  return { map, walks: () => walks };
}

/** Building thousands of sprites through Pixi inside jsdom dominates these tests; the assertions
 *  themselves only count full-collection walks. The default 5s testTimeout sits below what that
 *  setup costs on a slower machine, and a timed-out SYNC test keeps running — so the duration it
 *  reports is the machine's, not the assertion's. Allow the scene construction explicitly. */
const SETUP_TIMEOUT_MS = 180_000;

describe('ObjectLayer.removeObjects costs the removal, not the map', () => {
  it('drops exactly the removed ids from the LOD-tracked set', () => {
    const layer = new ObjectLayer();
    const N = 500;
    layer.addObjects(Array.from({ length: N }, (_, i) => place(`d${i}`, i)));
    const { map } = instrumentLodMap(layer);
    expect(map.size).toBe(N);

    layer.removeObjects(['d10', 'd200', 'd499']);
    expect(map.size).toBe(N - 3);
    expect(map.has('d10')).toBe(false);
    expect(map.has('d11')).toBe(true); // untouched neighbours survive
  }, SETUP_TIMEOUT_MS);

  it('never walks the whole collection while removing a handful, at any map size', () => {
    const N = 4000;
    const layer = new ObjectLayer();
    layer.addObjects(Array.from({ length: N }, (_, i) => place(`e${i}`, i)));
    const { walks } = instrumentLodMap(layer);

    // A road auto-trim's remove+add churn: many small removeObjects calls in a row,
    // mirroring the ~4-per-dab pattern a road stroke drives.
    for (let i = 0; i < 200; i++) layer.removeObjects([`e${i}`]);

    expect(walks()).toBe(0); // O(removed): no full pass over the other ~3800 survivors
  }, SETUP_TIMEOUT_MS);

  it('re-adding a removed id (idempotent replace) still costs O(1) per id, not O(map)', () => {
    const N = 2000;
    const layer = new ObjectLayer();
    layer.addObjects(Array.from({ length: N }, (_, i) => place(`f${i}`, i)));
    const { map, walks } = instrumentLodMap(layer);

    layer.addObjects([place('f5', 5)]); // addObjects removes-then-re-adds an existing id
    expect(walks()).toBe(0);
    expect(map.size).toBe(N); // replaced, not duplicated or leaked
  }, SETUP_TIMEOUT_MS);
});
