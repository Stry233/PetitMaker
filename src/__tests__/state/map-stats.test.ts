/**
 * Map statistics are memoized and patched. Patching is only safe while it is indistinguishable
 * from a rebuild, so these compare a patched result against one built from scratch and pin the
 * fallbacks that must give up and rebuild rather than serve a stale answer.
 */
import { describe, it, expect } from 'vitest';
import { bumpObjectsVersion, bumpCellsVersion, getCell } from '../../core/model/grid-model';
import { applyCommand } from '../../core/commands/command-apply';
import { EventBus } from '../../core/commands/event-bus';
import { CommandType, TerrainType, type EditorEvents, type GridState, type PlacedObject, type TrimCornersCommand } from '../../core/model/types';
import { CHUNK_SIZE } from '../../core/model/constants';
import { chunkKey } from '../../core/model/grid-model';
import { chunksOf, getMapStats } from '../../state/map-stats';
import { getActiveLayers } from '../../state/layer-utils';
import { makeState } from '../rules/_helpers';

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

function raise(state: GridState, x: number, y: number, elevation: number): void {
  const cell = getCell(state.cells, x, y)!;
  cell.terrain = { type: TerrainType.Mountain, elevation };
  bumpCellsVersion(state);
}

describe('map stats', () => {
  it('counts a cell in every layer up to its elevation', () => {
    const state = makeState();
    raise(state, 4, 4, 3);
    const stats = getMapStats(state);
    expect(stats.cellsByLayer[1]).toBe(1);
    expect(stats.cellsByLayer[3]).toBe(1);
    expect(stats.cellsByLayer[4]).toBe(0);
    expect(stats.maxElevation).toBe(3);
  });

  it('buckets object load by chunk', () => {
    const state = makeState();
    add(state, tree('a', 1, 1), tree('b', 20, 1));
    const stats = getMapStats(state);
    expect(stats.chunks.get('0,0')?.objects).toBe(1);
    expect(stats.chunks.get('1,0')?.objects).toBe(1);
  });

  it('serves the same object out of the cache while nothing changed', () => {
    const state = makeState();
    add(state, tree('a', 2, 2));
    expect(getMapStats(state)).toBe(getMapStats(state));
  });

  it('excludes a locked object from the per-layer object count, but keeps it in chunk load', () => {
    const state = makeState();
    const locked: PlacedObject = { ...tree('plaza', 4, 4), locked: true };
    add(state, locked);
    const stats = getMapStats(state);
    expect(stats.objectsByLayer[0]).toBe(0);
    // A locked structure still occupies its chunk's capacity — only patchOnly is excluded there.
    expect(stats.chunks.get('0,0')?.objects).toBe(1);

    add(state, tree('a', 2, 2));
    expect(getMapStats(state).objectsByLayer[0]).toBe(1);
  });

  it('counts a patchOnly object in its layer row but excludes it from chunk load', () => {
    const state = makeState();
    add(state, { ...tree('a', 2, 2), patchOnly: true });
    const stats = getMapStats(state);
    expect(stats.objectsByLayer[0]).toBe(1);
    expect(stats.chunks.get('0,0')).toBeUndefined();
  });

  it("reports the layer panel's per-layer counts", () => {
    const state = makeState();
    raise(state, 3, 3, 2);
    raise(state, 4, 3, 2);
    add(state, tree('a', 8, 8));
    const layers = getActiveLayers(state, 1);
    expect(layers.find((l) => l.elevation === 1)!.cellCount).toBe(2);
    expect(layers.find((l) => l.elevation === 0)!.cellCount).toBe(1);
  });
});

describe('chunksOf', () => {
  it('keys BOTH chunks a half-anchored footprint straddles, not just the one at its floored origin', () => {
    // A 1-wide deck anchored at x = CHUNK_SIZE - 0.5 spans [15.5, 16.5): half in chunk 0
    // (cols 0-15), half in chunk 1 (cols 16-31). Iterating `pos + integer offset` (the old body)
    // only ever visits Math.floor(pos) + 0, missing the trailing half cell's chunk entirely.
    const deck: PlacedObject = {
      id: 'd', catalogId: 'nope', position: { x: CHUNK_SIZE - 0.5, y: 0 }, width: 1, height: 1,
      rotation: 0, elevation: 0,
    };
    expect(chunksOf(deck).sort()).toEqual([chunkKey(0, 0), chunkKey(1, 0)].sort());
  });

  it('a whole-anchored footprint still keys exactly its own chunk (byte-identical pin)', () => {
    const tree: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    expect(chunksOf(tree)).toEqual([chunkKey(0, 0)]);
  });
});

describe('map stats: incremental patching', () => {
  it('patches to the same answer a rebuild would give', () => {
    const patched = makeState();
    add(patched, tree('a', 2, 2), tree('b', 6, 6));
    getMapStats(patched);                       // prime the cache
    add(patched, tree('c', 9, 9));              // then patch it

    const rebuilt = makeState();
    for (const o of [tree('a', 2, 2), tree('b', 6, 6), tree('c', 9, 9)]) rebuilt.objects.set(o.id, o);
    bumpObjectsVersion(rebuilt);                // no delta: forces a rebuild

    expect(getMapStats(patched).objectsByLayer).toEqual(getMapStats(rebuilt).objectsByLayer);
    expect([...getMapStats(patched).chunks]).toEqual([...getMapStats(rebuilt).chunks]);
  });

  it('patches the terrain half alone when only cells change and objects do not', () => {
    const state = makeState();
    add(state, tree('a', 2, 2));
    const primed = getMapStats(state);

    raise(state, 5, 5, 2); // cellsVersion moves; objectsVersion does not
    const patched = getMapStats(state);
    expect(patched).toBe(primed); // patched in place, not rebuilt

    const rebuilt = makeState();
    rebuilt.objects.set('a', tree('a', 2, 2));
    raise(rebuilt, 5, 5, 2);
    bumpObjectsVersion(rebuilt);
    const rebuiltStats = getMapStats(rebuilt);

    expect(patched.cellsByLayer).toEqual(rebuiltStats.cellsByLayer);
    expect(patched.maxElevation).toBe(rebuiltStats.maxElevation);
  });

  it('folds an in-place edit idempotently instead of double-counting it', () => {
    // command-apply.ts's road TrimCorners branch mutates the SAME PlacedObject in place
    // (new corners/rotation/patchOnly, same id) and republishes it as `added` — a re-index
    // request, not a new object. Mirrors state/object-index's re-add-in-place contract.
    const state = makeState();
    const original = tree('r', 2, 2);
    add(state, original);
    getMapStats(state); // prime

    const edited = { ...original, elevation: 3 };
    state.objects.set('r', edited);
    bumpObjectsVersion(state, { added: [edited] });
    const patched = getMapStats(state);

    const rebuilt = makeState();
    rebuilt.objects.set('r', edited);
    bumpObjectsVersion(rebuilt);
    const rebuiltStats = getMapStats(rebuilt);

    expect(patched.objectsByLayer).toEqual(rebuiltStats.objectsByLayer);
    expect(patched.maxElevation).toBe(rebuiltStats.maxElevation);
  });

  it('folds a patchOnly flip without leaving its stale chunk load behind', () => {
    const state = makeState();
    const original = tree('r', 2, 2);
    add(state, original); // counted toward chunk load
    getMapStats(state); // prime

    const edited = { ...original, patchOnly: true };
    state.objects.set('r', edited);
    bumpObjectsVersion(state, { added: [edited] }); // in-place edit, same id
    const patched = getMapStats(state);

    expect(patched.chunks.get('0,0')).toBeUndefined();
    // still stands in its layer row: patchOnly does not gate objectsByLayer.
    expect(patched.objectsByLayer[0]).toBe(1);
  });

  it('survives the real road TrimCorners re-index (command-apply.ts mutates the object in place)', () => {
    const state = makeState();
    add(state, road('r', 2, 2));
    getMapStats(state); // prime

    const bus = new EventBus<EditorEvents>();
    const trim: TrimCornersCommand = {
      type: CommandType.TrimCorners, timestamp: 0, x: 2, y: 2, layer: 'road', objectId: 'r',
      beforeCorners: undefined, afterCorners: ['square', 'fan', 'square', 'square'],
    };
    applyCommand(trim, state, bus); // mutates the SAME PlacedObject in place, republishes as `added`
    const patched = getMapStats(state);

    const rebuilt = makeState();
    add(rebuilt, road('r', 2, 2));
    applyCommand(trim, rebuilt, new EventBus<EditorEvents>());
    bumpObjectsVersion(rebuilt); // no delta: forces a rebuild, the ground truth
    const rebuiltStats = getMapStats(rebuilt);

    expect(patched.chunks.get('0,0')).toEqual(rebuiltStats.chunks.get('0,0'));
  });

  it('lowers maxElevation on removal instead of leaving it stale', () => {
    const state = makeState();
    const high = tree('high', 2, 2);
    add(state, high, tree('low', 5, 5));
    state.objects.set('high', { ...high, elevation: 5 });
    bumpObjectsVersion(state, { added: [{ ...high, elevation: 5 }] });
    expect(getMapStats(state).maxElevation).toBe(5);

    state.objects.delete('high');
    bumpObjectsVersion(state, { removed: [{ ...high, elevation: 5 }] });
    const patched = getMapStats(state);

    const rebuilt = makeState();
    rebuilt.objects.set('low', tree('low', 5, 5));
    bumpObjectsVersion(rebuilt);
    expect(patched.maxElevation).toBe(getMapStats(rebuilt).maxElevation);
    expect(patched.maxElevation).toBe(0);
  });

  it('keeps the terrain maximum when a patch removes the tallest object', () => {
    const state = makeState();
    raise(state, 1, 1, 4);
    const tall = tree('tall', 2, 2);
    add(state, { ...tall, elevation: 6 });
    expect(getMapStats(state).maxElevation).toBe(6);

    state.objects.delete('tall');
    bumpObjectsVersion(state, { removed: [{ ...tall, elevation: 6 }] });
    const patched = getMapStats(state);

    const rebuilt = makeState();
    raise(rebuilt, 1, 1, 4);
    bumpObjectsVersion(rebuilt);
    expect(patched.maxElevation).toBe(getMapStats(rebuilt).maxElevation);
    expect(patched.maxElevation).toBe(4);
  });

  it('patches correctly when a terrain raise and an object removal land in the same frame', () => {
    // The fragile combination: objectsDelta is usable AND cellsVersion also moved in one
    // getMapStats call, with the removed object taller than the terrain the raise adds.
    const state = makeState();
    const tall = tree('tall', 2, 2);
    add(state, { ...tall, elevation: 6 }, tree('low', 5, 5));
    getMapStats(state); // prime the cache

    state.objects.delete('tall');
    bumpObjectsVersion(state, { removed: [{ ...tall, elevation: 6 }] });
    raise(state, 1, 1, 3); // cellsVersion also moves before the next read
    const patched = getMapStats(state);

    const rebuilt = makeState();
    rebuilt.objects.set('low', tree('low', 5, 5));
    raise(rebuilt, 1, 1, 3);
    bumpObjectsVersion(rebuilt);

    expect(patched.maxElevation).toBe(getMapStats(rebuilt).maxElevation);
    expect(patched.maxElevation).toBe(3);
    expect(patched.cellsByLayer).toEqual(getMapStats(rebuilt).cellsByLayer);
    expect(patched.objectsByLayer).toEqual(getMapStats(rebuilt).objectsByLayer);
  });
});

describe('map stats: falls back to a rebuild rather than serving a stale answer', () => {
  it('rebuilds when an object mutation reports no delta', () => {
    const state = makeState();
    add(state, tree('a', 1, 1));
    const primed = getMapStats(state);

    const b = tree('b', 4, 4);
    state.objects.set('b', b);
    bumpObjectsVersion(state); // mutation site that does not say what changed

    const patched = getMapStats(state);
    expect(patched).not.toBe(primed);

    const rebuilt = makeState();
    rebuilt.objects.set('a', tree('a', 1, 1));
    rebuilt.objects.set('b', b);
    bumpObjectsVersion(rebuilt);
    expect(patched.objectsByLayer).toEqual(getMapStats(rebuilt).objectsByLayer);
  });

  it('rebuilds when a version was skipped, even where the delta looks applicable', () => {
    const state = makeState();
    const a = tree('a', 1, 1);
    add(state, a);
    const primed = getMapStats(state);

    const b = tree('b', 4, 4);
    add(state, b); // objectsVersion +1, delta describes this step, never read
    const c = tree('c', 6, 6);
    add(state, c); // objectsVersion +1 again — the cache is now two steps behind, not one

    const patched = getMapStats(state);
    expect(patched).not.toBe(primed);

    const rebuilt = makeState();
    for (const o of [a, b, c]) rebuilt.objects.set(o.id, o);
    bumpObjectsVersion(rebuilt);
    expect([...patched.chunks]).toEqual([...getMapStats(rebuilt).chunks]);
  });

  it('rebuilds when the delta removes an object the fold never saw', () => {
    const state = makeState();
    add(state, tree('a', 1, 1));
    getMapStats(state); // prime

    state.objects.delete('a');
    bumpObjectsVersion(state, { removed: [tree('ghost', 9, 9), tree('a', 1, 1)] });

    const patched = getMapStats(state);
    const rebuilt = makeState();
    bumpObjectsVersion(rebuilt);
    expect(patched.objectsByLayer).toEqual(getMapStats(rebuilt).objectsByLayer);
    expect(patched.objectsByLayer[0]).toBe(0);
  });
});
