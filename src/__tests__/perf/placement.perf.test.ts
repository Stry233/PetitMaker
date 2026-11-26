/*
 * The shared placement machinery's operation costs.
 *
 * Placement is the shared verb behind the designer's build stage, every smart-build press, and the
 * agent's tools, so its cost lands in all three. Covers the one-shot map read (`analyzeTerrain`), the road router over a built
 * map, the ecology populator over bare terrain, and one smart-build
 * press through the real (worker-free) `applyMacro` path. See `_harness.ts` for the gate and
 * methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { cloneWorld, denseIsland, makeWorld } from './_fixtures';
import type { World } from './_fixtures';
import { analyzeTerrain } from '../../tools/placement/analysis';
import type { PlacementAnalysis } from '../../tools/placement/analysis';
import { makeCtx } from '../../tools/placement/object';
import type { PlaceCtx } from '../../tools/placement/object';
import { connectRoadNetwork, nearestWalkable, type Node } from '../../tools/macros/roads/network';
import { scanPortals, type Portal } from '../../tools/macros/roads/portals';
import { placeNature } from '../../tools/macros/planting/nature';
import { buildCommunity, buildHabitatField } from '../../tools/macros/planting/habitat';
import { applyMacro } from '../../tools/macros';
import type { MacroContext } from '../../tools/macros';
import { objectRect } from '../../state/object-geometry';
import type { GridState } from '../../core/model/types';

const s = perfSuite('placement');

function networkFixture(island: World): { world: World; ctx: PlaceCtx; a: PlacementAnalysis; nodes: Node[]; regionAdj: Map<number, Portal[]> } {
  const world = cloneWorld(island);
  const a = analyzeTerrain(world.state);
  const ctx = makeCtx(world.state, (c) => world.executor.execute(c), world.executor.getRegistry(), 7);
  const plaza = [...world.state.objects.values()].find((o) => o.locked)!;
  const pr = objectRect(plaza);
  const seedPos = { x: Math.floor(pr.x + pr.w / 2), y: Math.floor(pr.y + pr.h / 2) };
  const hubPos = nearestWalkable(seedPos, a, new Set(), a.width, a.height) ?? seedPos;
  const nodes: Node[] = [{ kind: 'hub', pos: hubPos, region: a.region[hubPos.y * a.width + hubPos.x] ?? 0 }];
  const { regionAdj } = scanPortals(ctx, a);
  return { world, ctx, a, nodes, regionAdj };
}

/** Bare terrain: the dense map's ground with every non-locked object stripped before the
 *  executor exists, so its road lookup is built on the cleared state rather than one that still
 *  remembers pavement nothing stands on any more. */
function bareTerrainWorld(island: World): World {
  const state: GridState = {
    template: island.state.template,
    cells: structuredClone(island.state.cells),
    objects: new Map([...island.state.objects].filter(([, o]) => o.locked)),
    objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(island.state.lockedLayers),
  };
  return makeWorld(state);
}

function natureFixture(island: World): { world: World; ctx: PlaceCtx; a: PlacementAnalysis } {
  const world = bareTerrainWorld(island);
  const a = analyzeTerrain(world.state);
  const ctx = makeCtx(world.state, (c) => world.executor.execute(c), world.executor.getRegistry(), 7);
  return { world, ctx, a };
}

function macroFixture(island: World): { world: World; kit: MacroContext } {
  const world = cloneWorld(island);
  const kit: MacroContext = { state: world.state, executor: world.executor, registry: world.executor.getRegistry() };
  return { world, kit };
}

describe.runIf(PERF)('perf: placement', () => {
  it('analyzeTerrain over the dense map', async () => {
    const { state } = denseIsland();
    await s.bench('analysis/analyze-terrain', () => { analyzeTerrain(state, null); }, {
      meta: { width: state.template.width, height: state.template.height, objects: state.objects.size },
    });
  });

  it('connectRoadNetwork over a cloned dense map', async () => {
    const island = denseIsland();
    let f = networkFixture(island);
    await s.bench('network/build', () => {
      const start = f.world.executor.beginStroke();
      connectRoadNetwork(f.ctx, f.a, f.nodes, f.regionAdj, { variation: 7 });
      start.commit();
    }, {
      setup: () => { f = networkFixture(island); },
      minSamples: 3, maxSamples: 8, budgetMs: 6000,
      meta: { objects: island.state.objects.size },
    });
  });

  it('placeNature over a bare-terrain clone', async () => {
    const island = denseIsland();
    let f = natureFixture(island);
    await s.bench('nature/place', () => {
      const start = f.world.executor.beginStroke();
      placeNature(f.ctx, f.a, 1, new Set(), { pick: buildCommunity(buildHabitatField(f.a), (f.a.height >> 1) * f.a.width + (f.a.width >> 1), 7) });
      start.commit();
    }, {
      setup: () => { f = natureFixture(island); },
      minSamples: 3, maxSamples: 8, budgetMs: 6000,
    });
  });

  it('smart build: one patch-tree press through applyMacro (worker-free)', async () => {
    const island = denseIsland();
    let f = macroFixture(island);
    await s.bench('macros/smart-build-press', () => {
      applyMacro(f.kit, 'patch-tree', { seed: 7, at: { x: 40, y: 40 }, radius: 6 });
    }, {
      setup: () => { f = macroFixture(island); },
      minSamples: 3, maxSamples: 10, budgetMs: 6000,
    });
  });
});
