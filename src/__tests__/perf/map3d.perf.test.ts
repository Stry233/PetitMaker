/*
 * map3d.perf.test.ts — the 3D view's geometry-builder costs.
 *
 * Covers the paths a first 3D-view open and a live edit actually pay for: the full terrain build
 * (scene.ts meshes chunk by chunk, never the whole map in one call, so the bench loops chunks the
 * same way), a single dense chunk's remesh (the cells-changed path), the road trim decal over
 * every road tile, the object-instance resolver over every placed object, every catalog item's
 * bespoke ModelSpec build, and the chunk-dirty bookkeeping for a multi-cell edit burst. See
 * `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { denseIsland } from './_fixtures';
import { buildChunkTerrain, buildRoadTrimMeshes } from '../../canvas/map3d/build/terrain-geometry';
import { buildObjectInstances } from '../../canvas/map3d/build/object-meshes';
import { buildModel } from '../../canvas/map3d/models/build-model';
import { getSpec, modeledIds } from '../../canvas/map3d/models/registry';
import { dirtyChunksFor } from '../../canvas/map3d/build/chunk-dirty';
import { CHUNK_SIZE } from '../../core/model/constants';
import { getCatalogItem } from '../../state/catalog';
import { ItemCategory } from '../../core/model/types';
import type { MacroCoord } from '../../core/model/types';

const s = perfSuite('map3d');

describe.runIf(PERF)('perf: map3d', () => {
  it('terrain: full chunked build over the dense island (first 3D open)', async () => {
    const { state } = denseIsland();
    const chunksX = Math.ceil(state.template.width / CHUNK_SIZE);
    const chunksY = Math.ceil(state.template.height / CHUNK_SIZE);
    await s.bench('terrain/full-build', () => {
      for (let cy = 0; cy < chunksY; cy++) {
        for (let cx = 0; cx < chunksX; cx++) buildChunkTerrain(state, cx, cy);
      }
    }, {
      minSamples: 3, maxSamples: 8, budgetMs: 8000,
      meta: { chunks: chunksX * chunksY },
    });
  });

  it('terrain: one dense chunk remesh (the cells-changed path)', async () => {
    const { state } = denseIsland();
    // Chunk (3,4) sits under the plaza — the map's densest mesh, mixing mountain strata, water
    // and cut corners, so it is the chunk an edit there actually pays to remesh.
    const one = buildChunkTerrain(state, 3, 4);
    const verts = one.solid.positions.length + one.ground.positions.length + one.water.positions.length + one.fall.positions.length;
    await s.bench('terrain/one-chunk-remesh', () => { buildChunkTerrain(state, 3, 4); }, {
      meta: { vertices: verts / 3 },
    });
  });

  it('roads: trim-mesh decal over every road tile', async () => {
    const { state } = denseIsland();
    let roadTiles = 0;
    for (const obj of state.objects.values()) {
      if (getCatalogItem(obj.catalogId)?.category === ItemCategory.Road) roadTiles++;
    }
    await s.bench('roads/trim-mesh', () => { buildRoadTrimMeshes(state); }, {
      meta: { roadTiles },
    });
  });

  it('objects: instance resolver over every placed object', async () => {
    const { state } = denseIsland();
    await s.bench('objects/meshes-full', () => { buildObjectInstances(state); }, {
      meta: { objects: state.objects.size },
    });
  });

  it('models: build-model over every catalog item with a model3d spec', async () => {
    const ids = modeledIds();
    await s.bench('models/build-all', () => {
      // buildModel direct, bypassing registry.ts's own cache (modelGeometry) — this measures
      // the build, not a hit against it.
      for (const id of ids) buildModel(getSpec(id)!);
    }, {
      meta: { models: ids.length },
    });
  });

  it('chunk-dirty: bookkeeping for a 200-cell change burst', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    const cells: MacroCoord[] = [];
    for (let i = 0; i < 200; i++) cells.push({ x: (i * 7) % width, y: (i * 11) % height });
    await s.bench('chunk-dirty/burst', () => { dirtyChunksFor(cells, width, height); }, {
      meta: { cells: cells.length },
    });
  });
});
