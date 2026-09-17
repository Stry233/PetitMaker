/*
 * edge-cut.perf.test.ts — the edge-cut kernel and the road/terrain geometry it feeds.
 *
 * Covers the paths every trimmed cell and every road surface pay on a real map: the silhouette
 * primitive swept over every cell (what a full redraw reads), one reconcile pass over a changed
 * region (what a stroke/generation commit repairs), the auto-trim pass over a fresh large stroke
 * (what Auto Trim costs on a plateau, not a single dab), the connected road-surface union, the
 * per-tile road outline, and the per-corner cut backing (what a renderer asks for behind a cut).
 * See `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { cloneWorld, denseIsland, templateWorld } from './_fixtures';
import type { World } from './_fixtures';
import { CommandType, ItemCategory, TerrainType } from '../../core/model/types';
import type { Command, MacroCoord, PlacedObject, TerrainCell } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { realSurface, surfaceElevation, solidTopOf } from '../../core/edge-cut/terrain-silhouette';
import { reconcileCuts } from '../../core/edge-cut/cut-reconcile';
import { buildRoadRegions, updateRoadRegions } from '../../core/edge-cut/road-region';
import { roadBodyPoints } from '../../core/edge-cut/road-shape';
import { cutBackingByCorner } from '../../core/edge-cut/cut-backing';
import { applyAutoEdgeCut, edgeCutGeneratedTerrain } from '../../tools/edge-cut/auto-edge-cut';
import { roadLookup } from '../../state/object-index';
import { getCatalogItem } from '../../state/catalog';

const s = perfSuite('edge-cut');

/** The road tiles standing on a world — the same category filter `object-layer.ts` /
 *  `terrain-geometry.ts` apply before handing a tile list to the road-region builder. */
function roadObjectsOf(world: World): PlacedObject[] {
  const out: PlacedObject[] = [];
  for (const obj of world.state.objects.values()) {
    if (getCatalogItem(obj.catalogId)?.category === ItemCategory.Road) out.push(obj);
  }
  return out;
}

/**
 * The dense map, cut: `generateDesigned` never edge-cuts its own terrain (that pass is a
 * stroke/stencil concern, not the designed methodology's), so the raw fixture carries zero
 * trimmed corners anywhere. A clone run through the same whole-map trim the stencil generator
 * calls (`edgeCutGeneratedTerrain`, 'round') gives the kernel a realistic, varied population of
 * outer bevels/fans and Γ-notch fillets to sweep — built once and cached for every bench below.
 */
let cutIslandCache: World | null = null;
function cutIsland(): World {
  if (cutIslandCache) return cutIslandCache;
  const world = cloneWorld(denseIsland());
  const { width, height } = world.state.template;
  const terrainCells: MacroCoord[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (getCell(world.state.cells, x, y)?.terrain) terrainCells.push({ x, y });
    }
  }
  edgeCutGeneratedTerrain(
    { gridState: world.state, executeCommand: (cmd) => world.executor.execute(cmd) },
    terrainCells, 'round',
  );
  cutIslandCache = world;
  return world;
}

/** Every cell whose terrain carries an actual cut (some corner not square) — the population
 *  `cutBackingByCorner` is asked about, mirroring `layer-visibility.ts`'s and `surface-pieces.ts`'s
 *  per-cell sweep at full elevation (no hidden layers). */
function cutCellsOf(world: World): { x: number; y: number; terrain: TerrainCell }[] {
  const { width, height } = world.state.template;
  const out: { x: number; y: number; terrain: TerrainCell }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const terrain = getCell(world.state.cells, x, y)?.terrain;
      if (terrain?.corners?.some((c) => c !== 'square')) out.push({ x, y, terrain });
    }
  }
  return out;
}

/** The render tier `cutBackingByCorner` is asked at for a given cut cell — `patchOnly` reads its
 *  own elevation (the branch it special-cases), a ground-islet cut is asked at ground (0), and a
 *  real mountain/water cell is asked at its structural top, exactly as `surface-pieces.ts`'s
 *  non-patch, non-islet branch does. */
function renderTierFor(t: TerrainCell): number {
  if (t.patchOnly) return t.elevation;
  if (t.type === TerrainType.None) return 0;
  return solidTopOf(t, t.type);
}

describe.runIf(PERF)('perf: edge-cut', () => {
  it('real-surface sweep over every cell of the dense map', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    await s.bench('kernel/real-surface-sweep', () => {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const terrain = getCell(state.cells, x, y)?.terrain;
          realSurface(terrain);
          surfaceElevation(terrain);
        }
      }
    }, { meta: { cells: width * height } });
  });

  it('reconcileCuts: one pass over a cut terrain region', async () => {
    const island = cutIsland();
    const region: MacroCoord[] = [];
    for (let y = 50; y < 60; y++) for (let x = 20; x < 40; x++) region.push({ x, y });
    await s.bench('kernel/reconcile-cuts', () => {
      reconcileCuts(region, island.state, { execute: (cmd) => island.executor.execute(cmd), roadAt: roadLookup(island.state) });
    }, { meta: { cells: region.length } });
  });

  it('applyAutoEdgeCut over a freshly painted plateau', async () => {
    const PLATEAU: MacroCoord[] = [];
    for (let y = 20; y < 35; y++) for (let x = 20; x < 35; x++) PLATEAU.push({ x, y });
    let world: World = templateWorld();
    const paintPlateau = (w: World): void => {
      const start = w.executor.getUndoStackSize();
      w.executor.execute({
        type: CommandType.PaintTerrain, timestamp: Date.now(),
        cells: PLATEAU, terrainType: TerrainType.Mountain, elevation: 1,
      } as Command);
      w.executor.commitStrokeGroup(start);
    };
    await s.bench('auto-trim/large-stroke', () => {
      applyAutoEdgeCut(
        { gridState: world.state, roads: roadLookup(world.state), executeCommand: (cmd) => world.executor.execute(cmd) },
        'round', PLATEAU, [],
      );
    }, {
      setup: () => { world = templateWorld(); paintPlateau(world); },
      meta: { cells: PLATEAU.length },
    });
  });

  it('buildRoadRegions over every road tile of the dense map', async () => {
    const world = denseIsland();
    const roadObjs = roadObjectsOf(world);
    const roads = roadLookup(world.state);
    await s.bench('road-region/dense-island', () => {
      buildRoadRegions(roadObjs, roads);
    }, { meta: { roadTiles: roadObjs.length } });
  });

  it('updateRoadRegions with one paved cell dirty (the per-frame cost while paving)', async () => {
    const world = denseIsland();
    const roadObjs = roadObjectsOf(world);
    const roads = roadLookup(world.state);
    const prev = buildRoadRegions(roadObjs, roads);
    const at = roadObjs[Math.floor(roadObjs.length / 2)]!.position;
    const dirty = new Set([at.y * world.state.template.width + at.x]);
    await s.bench('road-region/incremental-step', () => {
      updateRoadRegions(prev, dirty, roadObjs, roads, world.state.template.width);
    }, { meta: { roadTiles: roadObjs.length, regions: prev.length } });
  });

  it('roadBodyPoints per road tile of the dense map', async () => {
    const world = denseIsland();
    const roadObjs = roadObjectsOf(world);
    const roads = roadLookup(world.state);
    await s.bench('road-shape/per-tile', () => {
      for (const obj of roadObjs) roadBodyPoints(roads, obj, obj.position.x, obj.position.y, 1, 1, 0);
    }, { meta: { roadTiles: roadObjs.length } });
  });

  it('cutBackingByCorner over every cut cell of the cut dense map', async () => {
    const world = cutIsland();
    const cells = cutCellsOf(world);
    await s.bench('cut-backing/sweep', () => {
      for (const { x, y, terrain } of cells) {
        const neighborAt = (dx: number, dy: number) => getCell(world.state.cells, x + dx, y + dy)?.terrain;
        cutBackingByCorner(terrain, renderTierFor(terrain), neighborAt);
      }
    }, { meta: { cutCells: cells.length } });
  });
});
