/**
 * The editor core must not know which game it edits: a game profile with other numbers is a valid
 * game. This drives the engine end to end under one with both grids shifted half a cell, no anchor landmark, another chunk size and
 * chunk load, fewer layers, a higher ground-support layer, another mountain-support rule, other
 * clearances, zone colours and planet limits: catalog load, a fresh map, a full post-stroke rule
 * sweep, a transfer onto another planet and a designed generation. Every module is imported inside
 * the test so that a module which throws at import fails the test rather than its collection.
 */
import { describe, it, expect, vi } from 'vitest';
import { defaultConfig } from '../../tools/generation/recipe';

// The first test imports the whole engine under the mocked profile.
vi.setConfig({ testTimeout: 60_000 });

const { ELEVATION_MAX } = vi.hoisted(() => ({ ELEVATION_MAX: 6 }));

vi.mock('../../core/game/profile', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../core/game/profile')>();
  const PALETTE = { elevation: real.PALETTE.elevation.slice(0, ELEVATION_MAX + 1), water: '#88ccee' };
  const zones = Object.fromEntries(Object.entries(real.ZONES)
    .map(([id, zone]) => [id, { ...zone, color: zone.sea && !zone.rim ? PALETTE.water : zone.color }]));
  return {
    ...real,
    GRIDS: { object: { offset: { x: 0.5, y: 0.5 } }, terrain: { offset: { x: 0, y: 0 } }, half: { offset: { x: 0.5, y: 0.5 }, size: 0.5 } },
    CHUNK_SIZE: 50,
    CHUNK_LOAD_LIMIT: 4_000,
    LOAD_DECIMALS: 2,
    GAME_NAME: 'Another Planet',
    ELEVATION_MAX,
    GROUND_SUPPORT_LAYER: 2,
    PALETTE,
    ZONES: zones,
    BASE_SUPPORT: { fromLayer: 3, reach: 2, window: 3 },
    CLEARANCE: { gateStripWidth: 1, gateStripDepth: 1, crossingEndSide: 1, gateMinArea: 9 },
    LANDMARKS: real.LANDMARKS.map((l) => ({ ...l, anchor: false })),
    ANCHOR_LANDMARK: undefined,
    PLANET_PROFILE: { ...real.PLANET_PROFILE, maxChunks: 4, shoreRadius: 2 },
  };
});

describe('another game profile', () => {
  it('the mock takes effect', async () => {
    const profile = await import('../../core/game/profile');
    expect(profile.CHUNK_SIZE).toBe(50);
    expect(profile.ELEVATION_MAX).toBe(ELEVATION_MAX);
    expect(profile.GROUND_SUPPORT_LAYER).toBe(2);
    expect(profile.ANCHOR_LANDMARK).toBeUndefined();
    expect(profile.LANDMARKS.some((l) => l.anchor)).toBe(false);
  });

  it('reads cells under a body and under a point from the object grid\'s offset', async () => {
    const { bodyEvidence, coveredCells, footprintCells, wholeCellsOf } = await import('../../core/grid/footprint');
    const { zoneCellAt } = await import('../../core/model/annotations');
    const { cellAtPoint } = await import('../../core/grid/pointer');
    const { mapPoint } = await import('../../core/grid/grids');
    const { PLACEMENT_GRID } = await import('../../core/game/profile');
    const square = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }];
    expect(footprintCells(0, 0, 1, 1)).toEqual(square);
    expect(bodyEvidence([{ x: 0, y: 0, w: 1, h: 1 }]).cells).toEqual(square);
    expect(coveredCells(0.5, 2, 'x')).toEqual([0, 1]);
    expect(wholeCellsOf({ x: 1, y: 1, w: 3, h: 3 })).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(zoneCellAt({ x: 0.2, y: 0.7 })).toEqual({ x: -1, y: 0 });
    expect(cellAtPoint(mapPoint({ x: 0.2, y: 0.7 }), PLACEMENT_GRID)).toEqual({ x: -1, y: 0 });
  });

  it('keeps the storage bucket an engine unit apart from the game chunk', async () => {
    const { BUCKET_SIZE, bucketCounts } = await import('../../core/grid/buckets');
    const { dirtyChunksFor } = await import('../../view/map3d/geometry/chunk-dirty');
    expect(BUCKET_SIZE).toBe(16);
    expect(bucketCounts(100, 40)).toEqual({ cols: 7, rows: 3 });
    expect([...dirtyChunksFor([{ x: 16, y: 0 }], 100, 40)].sort()).toEqual(['0,0', '1,0']);
  });

  it('loads the catalog, builds a map, sweeps the rules, transfers and generates', async () => {
    const { getCatalogItem, getRoadMaterials } = await import('../../state/catalog');
    const { makeTemplate } = await import('../_support/map-state');
    const { createGridState } = await import('../../core/model/template');
    const { createDefaultRegistry } = await import('../../rules/index');
    const { buildTransfer } = await import('../../tools/generation/transfer');
    const { createExecutor } = await import('../../state/executor');
    const { generateTerrain } = await import('../../tools/generation');

    const road = getRoadMaterials()[0]!;
    expect(getCatalogItem(road.id)).toBe(road);

    const template = makeTemplate(100, 100);
    const state = createGridState(template);
    expect(state.cells).toHaveLength(100);

    const registry = createDefaultRegistry();
    expect(registry.validatePostStroke(state)).toEqual([]);

    const moved = buildTransfer(state, makeTemplate(150, 100));
    expect(moved.violations).toEqual([]);

    const executor = createExecutor(state, registry);
    const start = executor.beginStroke();
    executor.transaction({ silent: true }, () => generateTerrain(
      { state, execute: (c) => executor.execute(c), reg: executor.getRegistry() },
      defaultConfig('designed', { seed: 4, richness: 0.7, maxElevation: ELEVATION_MAX })));
    expect(start.commit()).toEqual([]);
    expect(state.objects.size).toBeGreaterThan(0);
    const layers = state.cells.flatMap((row) => row.flatMap((cell) => cell.terrain?.elevation ?? []));
    expect(Math.max(0, ...layers)).toBeGreaterThan(0);
    expect(Math.max(0, ...layers)).toBeLessThanOrEqual(ELEVATION_MAX);
  });
});
