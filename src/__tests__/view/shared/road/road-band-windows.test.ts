/** Road material bands cut into map-grid windows: equal to a full recompute after any edit, tiling the single-pass bands, and reused by both views across rebuilds. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import ClipperLib from 'clipper-lib';
import {
  ROAD_BAND_WINDOW, __resetRoadMaterialCache, roadBandLayout, roadMaterialSettled, type RoadMaterialPatch,
} from '../../../../view/shared/road/material';
import { RoadBuildCache } from '../../../../view/shared/road/build-cache';
import { buildRoadRegions, updateRoadRegions, type RoadRegion } from '../../../../view/shared/road/region';
import { CANONICAL_ROAD_STATES } from '../../../../core/domain/edge-cut/road-cut-states';
import { type Corners, type PlacedObject } from '../../../../core/model/types';
import { copyCorners } from '../../../../core/model/corners';
import type { RoadMaterialSpec } from '../../../../config/catalog/road-material';
import type { RoadLookup } from '../../../../core/model/road-lookup';
import { getCatalogItem } from '../../../../state/catalog';
import { buildRoadTrimMeshes, RoadTrimCache } from '../../../../view/map3d/geometry/road-mesh';
import { makeState } from '../../../_support/map-state';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(() => roadMaterialSettled());

const MATERIALS = ['path-wavy-terracotta', 'path-urban-asphalt', 'path-overgrown-dirt'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

class Board {
  readonly tiles = new Map<string, PlacedObject>();
  constructor(readonly width: number, readonly height: number) {}
  readonly lookup: RoadLookup = (x, y) => this.tiles.get(`${x},${y}`) ?? null;
  get all(): PlacedObject[] { return [...this.tiles.values()]; }
  put(x: number, y: number, catalogId: string, corners?: Corners): void {
    this.tiles.set(`${x},${y}`, {
      id: `${catalogId}@${x},${y}`, catalogId, position: { x, y }, rotation: 0, elevation: 0,
      ...(corners ? { corners: copyCorners(corners) } : {}),
    });
  }
}

function randomBoard(random: () => number, material: string, size: number): Board {
  const board = new Board(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (random() < 0.62) board.put(x, y, material, random() < 0.15 ? randomCut(random) : undefined);
  }
  return board;
}

const randomCut = (random: () => number): Corners | undefined =>
  CANONICAL_ROAD_STATES[Math.floor(random() * CANONICAL_ROAD_STATES.length)];

/** Every band window of every region, by key. */
function windowsOf(
  regions: readonly RoadRegion[], spec: RoadMaterialSpec, read: (key: string, make: () => RoadMaterialPatch[]) => RoadMaterialPatch[],
): Map<string, RoadMaterialPatch[]> {
  const out = new Map<string, RoadMaterialPatch[]>();
  for (const region of regions) {
    for (const window of roadBandLayout(region, spec).windows) out.set(window.key, read(window.key, () => window.patches()));
  }
  return out;
}

/** Net area of a set of Clipper paths, in cells squared. */
function pathArea(paths: ClipperLib.Paths): number {
  let area = 0;
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      const a = path[i]!, b = path[(i + 1) % path.length]!;
      area += a.X * b.Y - b.X * a.Y;
    }
  }
  return Math.abs(area) / 2 / 4096 ** 2;
}

const toPaths = (patches: RoadMaterialPatch[]): ClipperLib.Paths => patches.flatMap((p) => p.polygons.flat())
  .map((ring) => ring.map(([x, y]) => ({ X: Math.round(x * 4096), Y: Math.round(y * 4096) })));

function union(paths: ClipperLib.Paths, clip: ClipperLib.Paths = []): ClipperLib.Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.Paths = [];
  c.Execute(clip.length ? ClipperLib.ClipType.ctIntersection : ClipperLib.ClipType.ctDifference, out,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}

describe('road band windows', () => {
  it.each(MATERIALS)('equal a full recompute after random edits for %s', (material) => {
    const spec = getCatalogItem(material)!.roadMaterial!;
    const random = rng(material.length * 7919);
    const board = randomBoard(random, material, 44);
    const kept = new RoadBuildCache<RoadMaterialPatch[]>();
    let regions = buildRoadRegions(board.all, board.lookup);
    windowsOf(regions, spec, (key, make) => kept.get(key, make));
    kept.finish();
    for (let edit = 0; edit < 24; edit++) {
      const dirty = new Set<number>();
      // Strokes of one to three cells, each adding, removing or re-cutting a tile.
      for (let n = 1 + Math.floor(random() * 3); n > 0; n--) {
        const x = Math.floor(random() * board.width), y = Math.floor(random() * board.height);
        const here = board.lookup(x, y);
        const roll = random();
        if (!here) board.put(x, y, material, roll < 0.3 ? randomCut(random) : undefined);
        else if (roll < 0.5) board.tiles.delete(`${x},${y}`);
        else board.put(x, y, material, randomCut(random));
        dirty.add(y * board.width + x);
      }
      regions = updateRoadRegions(regions, dirty, board.all, board.lookup, board.width);
      const incremental = windowsOf(regions, spec, (key, make) => kept.get(key, make));
      kept.finish();
      if (edit % 6 !== 5) continue;
      __resetRoadMaterialCache();
      const full = windowsOf(buildRoadRegions(board.all, board.lookup), spec, (_key, make) => make());
      expect([...incremental.keys()].sort()).toEqual([...full.keys()].sort());
      for (const [key, patches] of full) expect(incremental.get(key), key).toEqual(patches);
    }
  });

  it.each(MATERIALS)('tile the single-pass bands of %s', (material) => {
    const spec = getCatalogItem(material)!.roadMaterial!;
    const board = randomBoard(rng(material.length * 104729), material, 40);
    let covered = 0;
    for (const region of buildRoadRegions(board.all, board.lookup)) {
      const windowed = roadBandLayout(region, spec).windows.flatMap((w) => w.patches());
      const whole = roadBandLayout(region, spec, 1024).windows.flatMap((w) => w.patches());
      for (const color of new Set(whole.map((p) => p.color))) {
        const a = toPaths(windowed.filter((p) => p.color === color));
        const b = toPaths(whole.filter((p) => p.color === color));
        const areaA = pathArea(union(a)), areaB = pathArea(union(b));
        const shared = pathArea(union(a, b));
        // The symmetric difference: what one covers and the other does not.
        expect(areaA + areaB - 2 * shared, color).toBeLessThan(1e-4);
        covered += areaB;
      }
    }
    expect(covered).toBeGreaterThan(100);
  });

  it('changes only the window keys within reach of an edit', () => {
    const spec = getCatalogItem('path-wavy-terracotta')!.roadMaterial!;
    const board = new Board(96, 4);
    for (let x = 0; x < 96; x++) for (let y = 0; y < 4; y++) board.put(x, y, 'path-wavy-terracotta');
    const keys = (b: Board) => roadBandLayout(buildRoadRegions(b.all, b.lookup)[0]!, spec).windows.map((w) => w.key);
    const before = keys(board);
    expect(before).toHaveLength(96 / ROAD_BAND_WINDOW);
    board.put(40, 3, 'path-wavy-terracotta', ['square', 'square', 'square', 'fan']);
    const after = keys(board);
    const changed = after.filter((key, i) => key !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(2);
    expect(after[0]).toBe(before[0]);
    expect(after[after.length - 1]).toBe(before[before.length - 1]);
  });
});

describe('3D road rebuilds', () => {
  function networkState(): ReturnType<typeof makeState> {
    const state = makeState(48, 48);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      if (x % 6 < 2 || y % 6 < 2) {
        const road: PlacedObject = { id: `${x},${y}`, catalogId: 'path-wavy-terracotta', position: { x, y }, rotation: 0, elevation: 0 };
        state.objects.set(road.id, road);
      }
    }
    return state;
  }

  it('reuse every band window across tween frames and move previews', () => {
    const state = networkState();
    const cache = new RoadTrimCache();
    let misses = 0;
    const get = cache.cores.get.bind(cache.cores);
    cache.cores.get = (key, build) => get(key, () => { misses++; return build(); });
    const rest = buildRoadTrimMeshes(state, undefined, undefined, cache);
    const windows = misses;
    expect(windows).toBeGreaterThan(1);
    const movers = ['0,0', '1,0', '0,1', '1,1'];
    const frameMisses: number[] = [];
    for (let k = 1; k <= 4; k++) {
      misses = 0;
      const offsets = new Map(movers.map((id, i) => [id, { dx: 0.1 * k * (i + 1), dz: 0.05 * k }]));
      buildRoadTrimMeshes(state, undefined, offsets, cache);
      frameMisses.push(misses);
    }
    // The first frame adds the carried tiles and the re-cut corner window of the standing surface.
    expect(frameMisses[0]).toBeGreaterThan(0);
    expect(frameMisses[0]).toBeLessThan(windows);
    expect(frameMisses.slice(1)).toEqual([0, 0, 0]);
    misses = 0;
    const preview = new Map(state.objects);
    preview.set('0,0', { ...state.objects.get('0,0')!, position: { x: 44, y: 44 } });
    buildRoadTrimMeshes({ ...state, objects: preview }, undefined, undefined, cache);
    expect(misses).toBeLessThanOrEqual(3);
    misses = 0;
    const landed = buildRoadTrimMeshes(state, undefined, undefined, cache);
    expect(misses).toBeLessThanOrEqual(3);
    expect(landed.map((p) => p.mesh.positions)).toEqual(rest.map((p) => p.mesh.positions));
  });
});
