/**
 * The object index is memoized per GridState and PATCHED from `state.objectsDelta`
 * rather than rebuilt, because rebuilding costs one catalog lookup + rect + chunk
 * bucketing per object and a stroke mutates objects once per cell (a road fill on a
 * decorated map spent ~85% of its time rebuilding).
 *
 * Patching is only safe while it is indistinguishable from a rebuild, so these tests
 * compare a patched index against one built from scratch over the same objects, and
 * pin the fallbacks that must give up and rebuild rather than serve a stale answer.
 */
import { describe, it, expect } from 'vitest';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { ItemCategory, type GridState, type PlacedObject } from '../../core/model/types';
import { entriesNear, getObjectIndex, objectAt, type ObjectIndex } from '../../state/object-index';
import { PLAZA_ID } from '../../core/model/constants';
import { registerCatalogItem } from '../../state/catalog';
import { makeState } from '../rules/_helpers';

registerCatalogItem({
  id: 'hs-hit-test-deck', category: ItemCategory.Facility, name: { en: 'HalfStep Hit-Test Deck' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }],
});

function tree(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'tree-apple', position: { x, y }, rotation: 0, elevation: 0 };
}
function road(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'road-dirt', position: { x, y }, rotation: 0, elevation: 0 };
}

function add(state: GridState, ...objs: PlacedObject[]): void {
  for (const o of objs) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: objs });
}
function remove(state: GridState, ...objs: PlacedObject[]): void {
  for (const o of objs) state.objects.delete(o.id);
  bumpObjectsVersion(state, { removed: objs });
}

/** A from-scratch index over the same objects in the same Map order: a second
 *  GridState is a different memo key, so this can never return a patched index. */
function rebuilt(state: GridState): ObjectIndex {
  const fresh = makeState(state.template.width, state.template.height);
  for (const [id, obj] of state.objects) fresh.objects.set(id, obj);
  return getObjectIndex(fresh);
}

/** Everything a consumer can observe, in consumer-visible form (ords may differ
 *  between a patched and a rebuilt index; the ORDER they impose may not). */
function shape(index: ObjectIndex, state: GridState): unknown {
  return {
    order: index.entries.map(e => e.obj.id),
    roads: [...index.roadByCell].map(([k, o]) => `${k}=${o.id}`).sort(),
    counts: [...index.countByCatalog].sort(),
    chunks: [...index.byChunk].map(([k, b]) => `${k}:${b.map(e => e.obj.id).sort().join(',')}`).sort(),
    // the actual query surface, over a rect spanning the whole populated area
    near: entriesNear(index, { x: 0, y: 0, w: state.template.width, h: state.template.height }).map(e => e.obj.id),
  };
}

function expectMatchesRebuild(state: GridState): ObjectIndex {
  const index = getObjectIndex(state);
  expect(shape(index, state)).toEqual(shape(rebuilt(state), state));
  expect(index.entries.length).toBe(state.objects.size);
  return index;
}

describe('object-index: incremental patching', () => {
  it('matches a from-scratch build across adds, removes and re-adds', () => {
    const state = makeState(40, 40);
    add(state, tree('a', 1, 1), tree('b', 12, 3));
    expectMatchesRebuild(state);

    add(state, road('r1', 2, 2), road('r2', 20, 20));
    expectMatchesRebuild(state);

    remove(state, state.objects.get('b') as PlacedObject);
    expectMatchesRebuild(state);

    // coat over an existing road: strip then place, the tile brush's per-cell shape
    remove(state, state.objects.get('r1') as PlacedObject);
    add(state, road('r3', 2, 2));
    expectMatchesRebuild(state);

    remove(state, state.objects.get('r2') as PlacedObject, state.objects.get('r3') as PlacedObject);
    expectMatchesRebuild(state);
    expect(getObjectIndex(state).roadByCell.size).toBe(0);
  });

  it('keeps insertion order when an id is re-added in place, like Map.set does', () => {
    const state = makeState(30, 30);
    add(state, tree('a', 1, 1), tree('b', 5, 5), tree('c', 9, 9));
    getObjectIndex(state);

    // rotate/edit: same id set back onto the Map, which keeps its position
    const rotated: PlacedObject = { ...tree('b', 5, 5), rotation: 90 };
    state.objects.set('b', rotated);
    bumpObjectsVersion(state, { added: [rotated] });

    expect(getObjectIndex(state).entries.map(e => e.obj.id)).toEqual(['a', 'b', 'c']);
    expectMatchesRebuild(state);
    expect(getObjectIndex(state).byId.get('b')?.obj.rotation).toBe(90);
  });

  it('patches in place instead of rebuilding, so a long stroke stays linear', () => {
    const state = makeState(60, 60);
    for (let i = 0; i < 300; i++) add(state, tree(`t${i}`, 40 + (i % 10), 40 + Math.floor(i / 10)));
    const before = getObjectIndex(state).entries;

    // the tile-brush shape: place one object per cell, reading the index between cells
    for (let i = 0; i < 400; i++) {
      add(state, road(`p${i}`, i % 20, Math.floor(i / 20)));
      entriesNear(getObjectIndex(state), { x: i % 20, y: Math.floor(i / 20), w: 1, h: 1 });
    }

    // a rebuild allocates fresh structures; the same array means all 400 were patched
    expect(getObjectIndex(state).entries).toBe(before);
    expectMatchesRebuild(state);
  });
});

describe('object-index: falls back to a rebuild rather than serving a stale index', () => {
  it('rebuilds when a mutation reports no delta', () => {
    const state = makeState(30, 30);
    add(state, tree('a', 1, 1));
    const before = getObjectIndex(state).entries;

    const t = tree('b', 4, 4);
    state.objects.set(t.id, t);
    bumpObjectsVersion(state); // mutation site that does not say what changed

    expect(getObjectIndex(state).entries).not.toBe(before);
    expectMatchesRebuild(state);
  });

  it('rebuilds when the delta does not describe the whole change', () => {
    const state = makeState(30, 30);
    add(state, tree('a', 1, 1), tree('b', 4, 4));
    getObjectIndex(state);

    const c = tree('c', 8, 8), d = tree('d', 9, 9);
    state.objects.set(c.id, c);
    state.objects.set(d.id, d);
    bumpObjectsVersion(state, { added: [c] }); // d omitted

    expectMatchesRebuild(state);
    expect(getObjectIndex(state).byId.has('d')).toBe(true);
  });

  it('rebuilds when the delta removes something that was never indexed', () => {
    const state = makeState(30, 30);
    add(state, tree('a', 1, 1));
    getObjectIndex(state);

    state.objects.delete('a');
    bumpObjectsVersion(state, { removed: [tree('ghost', 2, 2), tree('a', 1, 1)] });

    expectMatchesRebuild(state);
    expect(getObjectIndex(state).entries).toEqual([]);
  });

  it('rebuilds when a version was skipped, even where the delta looks applicable', () => {
    // A delta only describes ITS OWN step. Two size-neutral swaps with no read
    // between them leave a delta that a one-behind cache could apply cleanly —
    // right object count, every removal present — and still be wrong about the
    // step it never saw. Only the version check separates the two.
    const state = makeState(30, 30);
    const a = tree('a', 1, 1), b = tree('b', 4, 4);
    add(state, a, b);
    getObjectIndex(state);

    const c = tree('c', 6, 6);
    state.objects.delete('a');
    state.objects.set(c.id, c);
    bumpObjectsVersion(state, { removed: [a], added: [c] }); // never read

    const d = tree('d', 8, 8);
    state.objects.delete('b');
    state.objects.set(d.id, d);
    bumpObjectsVersion(state, { removed: [b], added: [d] });

    expect(getObjectIndex(state).entries.map(e => e.obj.id)).toEqual(['c', 'd']);
    expectMatchesRebuild(state);
  });
});

describe('objectAt', () => {
  it('reports the object covering a cell, and nothing on a bare one', () => {
    const state = makeState(30, 30);
    add(state, tree('a', 4, 4));
    expect(objectAt(getObjectIndex(state), { x: 4, y: 4 })?.id).toBe('a');
    expect(objectAt(getObjectIndex(state), { x: 5, y: 4 })).toBeNull();
  });

  it('answers with the FIRST object in insertion order where footprints stack', () => {
    // A coating is coated OVER, so a road and the object above it legally share a cell; hit-testing
    // must not depend on chunk-bucket order.
    const state = makeState(30, 30);
    add(state, road('r', 7, 7));
    add(state, tree('t', 7, 7));
    expect(objectAt(getObjectIndex(state), { x: 7, y: 7 })?.id).toBe('r');
  });

  it('finds a locked object, because locked governs modification and not hit-testing', () => {
    // The 3D view picks by mesh id and never consulted a locked filter, so the plaza was
    // selectable there and not in 2D: the same click answered two ways per view. A FRACTIONAL
    // footprint (the plaza's) is covered here too — it carries its own width/height.
    const state = makeState(20, 20);
    const plaza: PlacedObject = {
      id: PLAZA_ID, catalogId: PLAZA_ID, position: { x: 4.5, y: 4.5 }, width: 3, height: 3,
      rotation: 0, elevation: 0, locked: true,
    };
    add(state, plaza);
    expect(objectAt(getObjectIndex(state), { x: 5, y: 5 })?.id).toBe(PLAZA_ID);
  });

  it('skips an object whose catalogId is unknown, since it has no footprint to test', () => {
    const state = makeState(20, 20);
    add(state, { ...tree('x', 2, 2), catalogId: 'nope' });
    expect(objectAt(getObjectIndex(state), { x: 2, y: 2 })).toBeNull();
  });

  it('hit-tests a half-anchored deck by CELL OVERLAP, not by whether the cell origin sits inside it', () => {
    // A 1-wide deck anchored at x=10.5 spans [10.5, 11.5): it partially covers BOTH macro
    // columns 10 and 11 (`footprintCells`' floor/ceil expansion agrees), so a click on either
    // must hit it — the origin-inside-rect test used to answer column 10 (its origin 10 < 10.5)
    // and 12 (12 < 11.5 is false, so actually neither — the point is the OLD test disagreed with
    // what's actually drawn on 10, matching the 3D mesh raycast only by accident on 11).
    const state = makeState(30, 30);
    add(state, { id: 'd', catalogId: 'hs-hit-test-deck', position: { x: 10.5, y: 5 }, rotation: 0, elevation: 0 });
    expect(objectAt(getObjectIndex(state), { x: 10, y: 5 })?.id).toBe('d');
    expect(objectAt(getObjectIndex(state), { x: 11, y: 5 })?.id).toBe('d');
    expect(objectAt(getObjectIndex(state), { x: 9, y: 5 })).toBeNull();
    expect(objectAt(getObjectIndex(state), { x: 12, y: 5 })).toBeNull();
  });

  it('a whole-anchored object still hit-tests exactly its integer cells (fix is byte-identical there)', () => {
    const state = makeState(30, 30);
    add(state, tree('a', 4, 4));
    expect(objectAt(getObjectIndex(state), { x: 4, y: 4 })?.id).toBe('a');
    expect(objectAt(getObjectIndex(state), { x: 3, y: 4 })).toBeNull();
    expect(objectAt(getObjectIndex(state), { x: 5, y: 4 })).toBeNull();
  });
});
