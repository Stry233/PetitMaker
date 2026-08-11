import { describe, it, expect } from 'vitest';
import { chunkLoadViolations } from '../../rules/chunk-load';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../core/model/constants';
import type { GridState, PlacedObject } from '../../core/model/types';
import { ItemCategory } from '../../core/model/types';
import { bumpObjectsVersion, chunkKey } from '../../core/model/grid-model';
import { makeRng, type Rng } from '../../core/model/rng';
import { getCatalogItem, registerCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getMapStats } from '../../state/map-stats';
import { makeState } from './_helpers';

// This exercises chunkLoadViolations directly, the same way the gated-off rule would once
// CHUNK_LOAD_ENABLED flips true — see chunk-load.test.ts for the flag itself staying off.
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

/** Wraps `objects` so every entry a read actually pulls out of the map increments `counter.n`.
 *  That is the cost the rule's O(footprint)-not-O(objects) claim is about: it counts objects the
 *  rule *looked at*, not calls made.
 *
 *  A Map can be walked five ways, and all five are charged here. Watching only `values()` reads
 *  zero for the same O(objects) scan written as `for (const [id, o] of objects)`,
 *  `objects.forEach(...)` or `objects.entries()` — idioms this codebase already uses — so a
 *  one-idiom counter would pass a rule that walks the whole map. */
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

    // Warm the cache once, as the live app has always done by the time a placement is checked.
    getMapStats(small);
    getMapStats(large);

    // The mutation between warm-up and measurement is what makes this measure anything: the
    // same two calls command-apply.ts's own PlaceObject case makes, `state.objects.set` then
    // `bumpObjectsVersion` with a foldable delta. Without one, getMapStats returns through its
    // objectsUnchanged fast path and the reading only shows that a memo hits when nothing
    // changed. This forces it past that and into the canPatch fold, which is the cost that
    // applies while the map is being edited.
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

    // map-stats' canPatch fold reads only the delta's own added/removed arrays, never
    // state.objects — so a correctly-delta'd single-object edit keeps this independent of
    // map size. (The sibling test below shows what happens when the delta is missing.)
    expect(smallCounter.n).toBe(largeCounter.n);
  });

  it('documents map-stats\' rebuild fallback: a version bump with no delta reverts the cost to the map\'s object count', () => {
    const candidate = obj('candidate', 500, 500);

    const small = scatterObjects(100, 1000, makeRng(3));
    const large = scatterObjects(4000, 1000, makeRng(4));

    getMapStats(small);
    getMapStats(large);

    // grid-model.ts documents this as SAFE ("omitting [the delta] is safe... only slower"),
    // and real call sites take it — the reviewer traced drag/rotate ghost updates on every
    // pointer-move frame, road-reconcile.ts, generator clearance sweeps and agent
    // strip-placements as flows that desync the cache this way. It is not this rule's
    // mistake to fix: chunkLoadViolations only calls getMapStats(state), and map-stats
    // itself is the thing deciding whether it can trust a patch or must rebuild.
    const addedSmall = obj('added-small', 1, 1);
    const addedLarge = obj('added-large', 1, 1);
    small.objects.set(addedSmall.id, addedSmall);
    bumpObjectsVersion(small); // no delta
    large.objects.set(addedLarge.id, addedLarge);
    bumpObjectsVersion(large); // no delta

    const smallCounter = { n: 0 };
    const largeCounter = { n: 0 };
    small.objects = countingObjects(small.objects, smallCounter);
    large.objects = countingObjects(large.objects, largeCounter);

    chunkLoadViolations(small, candidate, ITEM_LOAD);
    chunkLoadViolations(large, candidate, ITEM_LOAD);

    // A version bump map-stats can't trust forces its rebuild() path, which walks every
    // object in state.objects once — so the visit count tracks each map's own object count
    // (not the candidate's footprint), and the two maps disagree. This is map-stats' own
    // staleness-never/speed-sometimes contract showing through the rule, not a property of
    // the rule's own logic.
    expect(smallCounter.n).toBe(small.objects.size);
    expect(largeCounter.n).toBe(large.objects.size);
    expect(smallCounter.n).not.toBe(largeCounter.n);
  });
});

/** A deliberately naive per-chunk load tally, independent of anything under test: it sums
 *  every non-candidate object's catalog loadValue into the chunks its footprint touches and
 *  compares against CHUNK_LOAD_LIMIT directly. This is the ground truth chunkLoadViolations
 *  must agree with; it must outlive whatever production implementation it is checked against. */
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
    // A dense cluster inside one chunk (0,0) so some candidates there are refused purely by
    // existing load, not just by their own — exercising the "already over" branch too.
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
    // A guard on the guard: if every draw landed on one side, the loop above proved nothing.
    expect(sawAllowed).toBe(true);
    expect(sawRejected).toBe(true);
  });
});

// A 2x2 fixture, for the case a 1x1 cannot reach: a footprint straddling a chunk boundary is
// charged in full to every chunk it touches, not divided among them. registerCatalogItem is
// test-support (state/catalog.ts), not used in production code.
const WIDE_ID = 'chunk-load-test-2x2';
registerCatalogItem({
  id: WIDE_ID, category: ItemCategory.Building, name: { en: 'Chunk Test 2x2' },
  width: 2, height: 2, loadValue: 1000, rotatable: false, placementMode: 'point',
  traits: [],
});

describe('chunkLoadViolations multi-chunk footprint', () => {
  it('charges a footprint spanning four chunks the full load in every one of them', () => {
    const state = makeState(48, 48);
    // (15,15) size 2x2 covers (15,15) (16,15) (15,16) (16,16) — one cell in each of the four
    // chunks (0,0) (1,0) (0,1) (1,1), CHUNK_SIZE=16.
    const existing: PlacedObject = { id: 'wide', catalogId: WIDE_ID, position: { x: 15, y: 15 }, rotation: 0, elevation: 0 };
    state.objects.set(existing.id, existing);

    const spanning = (id: string): PlacedObject => (
      { id, catalogId: WIDE_ID, position: { x: 15, y: 15 }, rotation: 0, elevation: 0 }
    );
    // 1000 (existing, credited in full to every one of the four touched chunks) + 9001 > 10000.
    expect(chunkLoadViolations(state, spanning('over'), 9001)).toHaveLength(1);
    // 1000 + 8999 == 9999 <= 10000 in every touched chunk.
    expect(chunkLoadViolations(state, spanning('under'), 8999)).toHaveLength(0);

    // A candidate whose footprint shares none of those four chunks is unaffected by them.
    const far: PlacedObject = { id: 'far', catalogId: WIDE_ID, position: { x: 32, y: 32 }, rotation: 0, elevation: 0 };
    expect(chunkLoadViolations(state, far, 9999)).toHaveLength(0);
  });
});
