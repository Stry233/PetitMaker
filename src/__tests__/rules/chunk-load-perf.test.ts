import { describe, it, expect } from 'vitest';
import { chunkLoadViolations } from '../../rules/chunk-load';
import type { GridState, PlacedObject } from '../../core/model/types';
import { ItemCategory } from '../../config/catalog/categories';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { chunkKey } from '../../core/grid/rect';
import { makeRng, type Rng } from '../../core/base/rng';
import { getCatalogItem, __setCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getMapStats } from '../../state/map-stats';
import { makeState } from '../_support/map-state';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../core/game/profile';

const CATALOG_ID = 'flower-daisy'; // 1x1, non-zero loadValue
const ITEM_LOAD = getCatalogItem(CATALOG_ID)!.loadValue;

function obj(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: CATALOG_ID, position: { x, y }, rotation: 0, elevation: 0 };
}

function scatterObjects(count: number, mapSize: number, rng: Rng): GridState {
  const state = makeState(mapSize, mapSize);
  for (let i = 0; i < count; i++) {
    state.objects.set(`obj-${i}`, obj(`obj-${i}`, rng.int(mapSize), rng.int(mapSize)));
  }
  return state;
}

/** Yields `iter` through, charging `counter` one per entry that comes out. Lazy, like the
 *  iterator it wraps: a walk that stops early is charged only for what it pulled. */
function* counted<T>(iter: Iterator<T>, counter: { n: number }): Generator<T> {
  for (let r = iter.next(); r.done !== true; r = iter.next()) {
    counter.n++;
    yield r.value;
  }
}

/** Wraps `objects` so every entry a read pulls out of the map increments `counter.n`: objects looked
 *  at, not calls made. All five ways of walking a Map are charged, so no spelling of a full scan
 *  escapes the count. */
function countingObjects(objects: Map<string, PlacedObject>, counter: { n: number }): Map<string, PlacedObject> {
  return new Proxy(objects, {
    get(target, prop) {
      if (prop === Symbol.iterator) return () => counted(target[Symbol.iterator](), counter);
      if (prop === 'entries') return () => counted(target.entries(), counter);
      if (prop === 'keys') return () => counted(target.keys(), counter);
      if (prop === 'values') return () => counted(target.values(), counter);
      if (prop === 'forEach') {
        return (fn: (v: PlacedObject, k: string, m: Map<string, PlacedObject>) => void, thisArg?: unknown) =>
          target.forEach((v, k, m) => { counter.n++; fn.call(thisArg, v, k, m); });
      }
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('chunkLoadViolations cost shape', () => {
  it('stays independent of map size across a real edit that map-stats can patch', () => {
    const candidate = obj('candidate', 500, 500);

    const small = scatterObjects(100, 1000, makeRng(1));
    const large = scatterObjects(4000, 1000, makeRng(2));

    // Warm the cache once, as the live app does before a placement is checked.
    getMapStats(small);
    getMapStats(large);

    // A placement as PlaceObject applies it (set, then a bump with a delta), so getMapStats takes its
    // patch path rather than the unchanged fast path.
    const addedSmall = obj('added-small', 1, 1);
    const addedLarge = obj('added-large', 1, 1);
    small.objects.set(addedSmall.id, addedSmall);
    bumpObjectsVersion(small, { added: [addedSmall] });
    large.objects.set(addedLarge.id, addedLarge);
    bumpObjectsVersion(large, { added: [addedLarge] });

    const smallCounter = { n: 0 };
    const largeCounter = { n: 0 };
    small.objects = countingObjects(small.objects, smallCounter);
    large.objects = countingObjects(large.objects, largeCounter);

    chunkLoadViolations(small, candidate, ITEM_LOAD);
    chunkLoadViolations(large, candidate, ITEM_LOAD);

    // The patch reads only the delta, never state.objects.
    expect(smallCounter.n).toBe(largeCounter.n);
  });

  it('documents map-stats\' rebuild fallback: a version bump with no delta reverts the cost to the map\'s object count', () => {
    const candidate = obj('candidate', 500, 500);

    const small = scatterObjects(100, 1000, makeRng(3));
    const large = scatterObjects(4000, 1000, makeRng(4));

    getMapStats(small);
    getMapStats(large);

    // Omitting the delta is allowed but slower.
    const addedSmall = obj('added-small', 1, 1);
    const addedLarge = obj('added-large', 1, 1);
    small.objects.set(addedSmall.id, addedSmall);
    bumpObjectsVersion(small);
    large.objects.set(addedLarge.id, addedLarge);
    bumpObjectsVersion(large);

    const smallCounter = { n: 0 };
    const largeCounter = { n: 0 };
    small.objects = countingObjects(small.objects, smallCounter);
    large.objects = countingObjects(large.objects, largeCounter);

    chunkLoadViolations(small, candidate, ITEM_LOAD);
    chunkLoadViolations(large, candidate, ITEM_LOAD);

    // A bump with no delta forces map-stats to rebuild, walking every object once.
    expect(smallCounter.n).toBe(small.objects.size);
    expect(largeCounter.n).toBe(large.objects.size);
    expect(smallCounter.n).not.toBe(largeCounter.n);
  });
});

/** A naive per-chunk load tally, independent of the code under test: every other object's loadValue
 *  summed into each chunk its footprint touches, compared against CHUNK_LOAD_LIMIT. */
function naiveVerdict(state: GridState, candidate: PlacedObject, loadValue: number): boolean {
  const { w, h } = getPlacedObjectSize(candidate);
  const touched = new Set<string>();
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      touched.add(chunkKey(Math.floor((candidate.position.x + dx) / CHUNK_SIZE), Math.floor((candidate.position.y + dy) / CHUNK_SIZE)));
    }
  }
  const loads = new Map<string, number>();
  for (const o of state.objects.values()) {
    if (o.id === candidate.id) continue;
    const oLoad = getCatalogItem(o.catalogId)?.loadValue ?? 0;
    const { w: ow, h: oh } = getPlacedObjectSize(o);
    for (let dy = 0; dy < oh; dy++) {
      for (let dx = 0; dx < ow; dx++) {
        const key = chunkKey(Math.floor((o.position.x + dx) / CHUNK_SIZE), Math.floor((o.position.y + dy) / CHUNK_SIZE));
        loads.set(key, (loads.get(key) ?? 0) + oLoad);
      }
    }
  }
  for (const key of touched) {
    if ((loads.get(key) ?? 0) + loadValue > CHUNK_LOAD_LIMIT) return false;
  }
  return true;
}

describe('chunkLoadViolations equivalence with the naive tally', () => {
  it('agrees with a from-scratch per-chunk tally over randomized placements', () => {
    const mapSize = 128;
    const rng = makeRng(42);
    const state = scatterObjects(600, mapSize, rng);
    // A dense cluster in chunk (0,0), so some candidates there are refused by existing load alone.
    for (let i = 0; i < 1200; i++) {
      state.objects.set(`cluster-${i}`, obj(`cluster-${i}`, rng.int(CHUNK_SIZE), rng.int(CHUNK_SIZE)));
    }

    let sawAllowed = false;
    let sawRejected = false;
    for (let i = 0; i < 300; i++) {
      const candidate = obj(`cand-${i}`, rng.int(mapSize), rng.int(mapSize));
      const loadValue = rng.int(5) * 3000; // 0..12000, straddles CHUNK_LOAD_LIMIT (10000)
      const ruleAllows = chunkLoadViolations(state, candidate, loadValue).length === 0;
      const expectedAllows = naiveVerdict(state, candidate, loadValue);
      expect(ruleAllows).toBe(expectedAllows);
      if (ruleAllows) sawAllowed = true; else sawRejected = true;
    }
    // Both verdicts occur, or the loop proved nothing.
    expect(sawAllowed).toBe(true);
    expect(sawRejected).toBe(true);
  });
});

// A 2x2 fixture for the case a 1x1 cannot reach: a footprint straddling a chunk boundary is
// charged in full to every chunk it touches, not divided among them.
const WIDE_ID = 'chunk-load-test-2x2';
__setCatalogItem({
  id: WIDE_ID, category: ItemCategory.Building, name: { en: 'Chunk Test 2x2' },
  width: 2, height: 2, loadValue: 1000, rotatable: false, placementMode: 'point',
  traits: [],
});

describe('chunkLoadViolations multi-chunk footprint', () => {
  it('charges a footprint spanning four chunks the full load in every one of them', () => {
    const state = makeState(48, 48);
    // A 2x2 at (15,15) puts one cell in each of chunks (0,0), (1,0), (0,1) and (1,1).
    const existing: PlacedObject = { id: 'wide', catalogId: WIDE_ID, position: { x: 15, y: 15 }, rotation: 0, elevation: 0 };
    state.objects.set(existing.id, existing);

    const spanning = (id: string): PlacedObject => (
      { id, catalogId: WIDE_ID, position: { x: 15, y: 15 }, rotation: 0, elevation: 0 }
    );
    // The existing 1000 is charged in full to each chunk: 1000 + 9001 > 10000.
    expect(chunkLoadViolations(state, spanning('over'), 9001)).toHaveLength(1);
    expect(chunkLoadViolations(state, spanning('under'), 8999)).toHaveLength(0);

    const far: PlacedObject = { id: 'far', catalogId: WIDE_ID, position: { x: 32, y: 32 }, rotation: 0, elevation: 0 };
    expect(chunkLoadViolations(state, far, 9999)).toHaveLength(0);
  });
});
