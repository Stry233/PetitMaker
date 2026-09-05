/*
 * state.perf.test.ts — the derived-state layer's operation costs.
 *
 * `state/` is where every "what is here?" question resolves without a scan:
 * the object index, the whole-map stats, the layer panel's derivation and the footprint geometry
 * underneath all three. Each is memoized and PATCHED from a mutation's delta rather than rebuilt —
 * this suite times both halves of that contract: the cold rebuild a missing/untrustworthy delta
 * falls back to, and the incremental patch a normal edit takes instead. See `_harness.ts` for the
 * gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { cloneWorld, denseIsland } from './_fixtures';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { entriesNear, getObjectIndex, objectAt, roadLookup } from '../../state/object-index';
import { getMapStats } from '../../state/map-stats';
import { getActiveLayers } from '../../state/layer-utils';
import { buildObjectOccupancy } from '../../state/object-geometry';
import type { PlacedObject } from '../../core/model/types';

const s = perfSuite('state');

describe.runIf(PERF)('perf: state', () => {
  it('object index: full rebuild after an untrusted (no-delta) invalidation', async () => {
    const world = cloneWorld(denseIsland());
    getObjectIndex(world.state); // prime a valid cache once before the first forced invalidation
    await s.bench('object-index/full-rebuild', () => {
      getObjectIndex(world.state);
    }, {
      // No delta: object-index.ts's own contract treats this as "something changed, but not
      // what" and rebuilds from scratch (one catalog lookup + rect + chunk bucketing per object).
      setup: () => { bumpObjectsVersion(world.state); },
      meta: { objects: world.state.objects.size },
    });
  });

  it('object index: patch fold for one placed object', async () => {
    const world = cloneWorld(denseIsland());
    getObjectIndex(world.state); // prime, so every add below folds a delta rather than rebuilding
    let i = 0;
    await s.bench('object-index/patch', () => {
      const obj: PlacedObject = {
        id: `perf-patch-${i}`, catalogId: 'tree-apple',
        position: { x: i % 40, y: Math.floor(i / 40) % 40 }, rotation: 0, elevation: 0,
      };
      i++;
      // The exact mutation site production code uses (command-apply.ts's PlaceObject branch):
      // set the object, then report the delta so the index folds it instead of rebuilding.
      world.state.objects.set(obj.id, obj);
      bumpObjectsVersion(world.state, { added: [obj] });
      getObjectIndex(world.state);
    });
  });

  it('object index: entriesNear over 100 scattered 10x10 rects', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const w = Math.max(1, width - 10), h = Math.max(1, height - 10);
    await s.bench('object-index/entries-near-100', () => {
      const index = getObjectIndex(state);
      for (let i = 0; i < 100; i++) {
        entriesNear(index, { x: (i * 37) % w, y: (i * 53) % h, w: 10, h: 10 });
      }
    }, { meta: { objects: state.objects.size } });
  });

  it('object index: objectAt over every cell of the map', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    await s.bench('object-index/object-at-sweep', () => {
      const index = getObjectIndex(state);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) objectAt(index, { x, y });
      }
    }, { meta: { objects: state.objects.size, cells: width * height } });
  });

  it('object index: roadByCell over every cell of the map', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const roadAt = roadLookup(state);
    await s.bench('object-index/road-by-cell-sweep', () => {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) roadAt(x, y);
      }
    }, { meta: { objects: state.objects.size, cells: width * height } });
  });

  it('map stats: cold rebuild after an untrusted (no-delta) invalidation', async () => {
    const world = cloneWorld(denseIsland());
    getMapStats(world.state); // prime
    await s.bench('map-stats/cold', () => {
      getMapStats(world.state);
    }, {
      // Mirrors the object-index cold bench: no delta forces rebuild() (walkTerrain plus a
      // full fold of every object), map-stats's own fallback for anything it cannot trust.
      setup: () => { bumpObjectsVersion(world.state); },
      meta: { objects: world.state.objects.size },
    });
  });

  it('map stats: patch fold for one placed object', async () => {
    const world = cloneWorld(denseIsland());
    getMapStats(world.state); // prime
    let i = 0;
    await s.bench('map-stats/patched', () => {
      const obj: PlacedObject = {
        id: `perf-mapstats-${i}`, catalogId: 'tree-apple',
        position: { x: i % 40, y: 40 + (Math.floor(i / 40) % 40) }, rotation: 0, elevation: 0,
      };
      i++;
      world.state.objects.set(obj.id, obj);
      bumpObjectsVersion(world.state, { added: [obj] });
      getMapStats(world.state);
    });
  });

  it('layer panel: getActiveLayers over the dense island', async () => {
    const { state } = denseIsland();
    await s.bench('layers/get-active', () => { getActiveLayers(state, 1); });
  });

  it('geometry: footprints over every placed object', async () => {
    const { state } = denseIsland();
    await s.bench('geometry/footprints-all', () => { buildObjectOccupancy(state); }, {
      meta: { objects: state.objects.size },
    });
  });
});
