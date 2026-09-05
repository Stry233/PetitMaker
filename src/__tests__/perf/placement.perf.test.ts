/*
 * placement.perf.test.ts — the shared placement machinery's operation costs.
 *
 * Placement is the shared verb behind the designer's build stage, every smart-build press, and the
 * agent's director tools (`decorate_zone`, `plant_forest`, `build_road_network`), so its cost lands
 * in all three. Covers the one-shot map read (`analyzeTerrain`), the road router over a built
 * island, the ecology populator over bare terrain, one themed room decorator, and one smart-build
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
import { buildNetwork, nearestWalkable, type Node } from '../../tools/placement/network';
import { scanPortals } from '../../tools/placement/portals';
import type { Portal } from '../../tools/placement/portals';
import { placeNature } from '../../tools/placement/nature';
import { decorateZone, type Zone } from '../../tools/placement/themes';
import { applyMacro } from '../../tools/macros';
import type { MacroContext } from '../../tools/macros';
import { makeRng } from '../../core/model/rng';
import { objectRect } from '../../state/object-geometry';
import { rectsOverlap } from '../../core/model/grid-model';
import type { GridState, PlacedObject } from '../../core/model/types';

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

/** A bare-terrain island: the dense map's ground with every non-locked object stripped BEFORE the
 *  executor exists, so its road lookup is built on the cleared state rather than one that still
 *  remembers pavement nothing stands on any more. */
function bareTerrainWorld(island: World): World {
  const state: GridState = {
    template: island.state.template,
    cells: structuredClone(island.state.cells),
    objects: new Map([...island.state.objects].filter(([, o]) => o.locked)),
    lockedLayers: new Set(island.state.lockedLayers),
  };
  return makeWorld(state);
}

function natureFixture(island: World): { world: World; ctx: PlaceCtx; a: PlacementAnalysis } {
  const world = bareTerrainWorld(island);
  const a = analyzeTerrain(world.state);
  const ctx = makeCtx(world.state, (c) => world.executor.execute(c), world.executor.getRegistry(), 7);
  return { world, ctx, a };
}

const ZONE_RECT = { x: 40, y: 40, w: 20, h: 20 };

function zoneFixture(island: World): { world: World; ctx: PlaceCtx; a: PlacementAnalysis; zone: Zone } {
  const inRect = (o: PlacedObject): boolean => rectsOverlap(objectRect(o), ZONE_RECT);
  const state: GridState = {
    template: island.state.template,
    cells: structuredClone(island.state.cells),
    objects: new Map([...island.state.objects].filter(([, o]) => o.locked || !inRect(o))),
    lockedLayers: new Set(island.state.lockedLayers),
  };
  const world = makeWorld(state);
  const a = analyzeTerrain(world.state);
  const ctx = makeCtx(world.state, (c) => world.executor.execute(c), world.executor.getRegistry(), 7);
  const cells: number[] = [];
  for (let y = ZONE_RECT.y; y < ZONE_RECT.y + ZONE_RECT.h; y++) {
    for (let x = ZONE_RECT.x; x < ZONE_RECT.x + ZONE_RECT.w; x++) cells.push(y * a.width + x);
  }
  const zone: Zone = {
    id: 1, cells, theme: 'hamlet',
    centroid: { x: ZONE_RECT.x + ZONE_RECT.w / 2, y: ZONE_RECT.y + ZONE_RECT.h / 2 },
  };
  return { world, ctx, a, zone };
}

function macroFixture(island: World): { world: World; kit: MacroContext } {
  const world = cloneWorld(island);
  const kit: MacroContext = { state: world.state, executor: world.executor, registry: world.executor.getRegistry() };
  return { world, kit };
}

describe.runIf(PERF)('perf: placement', () => {
  it('analyzeTerrain over the dense island', async () => {
    const { state } = denseIsland();
    await s.bench('analysis/analyze-terrain', () => { analyzeTerrain(state, null); }, {
      meta: { width: state.template.width, height: state.template.height, objects: state.objects.size },
    });
  });

  it('buildNetwork over a cloned dense island', async () => {
    const island = denseIsland();
    let f = networkFixture(island);
    await s.bench('network/build', () => {
      const start = f.world.executor.getUndoStackSize();
      buildNetwork(f.ctx, f.a, 1, f.nodes, f.regionAdj);
      f.world.executor.commitStrokeGroup(start);
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
      const start = f.world.executor.getUndoStackSize();
      placeNature(f.ctx, f.a, 1, new Set());
      f.world.executor.commitStrokeGroup(start);
    }, {
      setup: () => { f = natureFixture(island); },
      minSamples: 3, maxSamples: 8, budgetMs: 6000,
    });
  });

  it('decorateZone over a cleared district rect', async () => {
    const island = denseIsland();
    let f = zoneFixture(island);
    await s.bench('themes/decorate-zone', () => {
      const start = f.world.executor.getUndoStackSize();
      decorateZone(f.ctx, f.a, f.zone, 1, 1, new Set(), makeRng(7));
      f.world.executor.commitStrokeGroup(start);
    }, {
      setup: () => { f = zoneFixture(island); },
      minSamples: 5, maxSamples: 30,
      meta: { cells: ZONE_RECT.w * ZONE_RECT.h },
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
