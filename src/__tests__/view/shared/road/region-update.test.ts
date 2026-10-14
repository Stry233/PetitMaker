/**
 * `updateRoadRegions` must be `buildRoadRegions` exactly: the incremental path hands back kept
 * regions and rebuilt ones, and the two together have to match the full build region for region —
 * signatures (members, positions, corners), cells, and sampled ring geometry — through every kind
 * of edit the layer reports (a tile added, removed, trimmed; a burst of each; edits that split one
 * surface or bridge two), and so must the print-diffing cache both views keep. The walk is seeded,
 * so a failure names a reproducible step.
 */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { getPlaceableByCategory } from '../../../../state/catalog';
import { buildRoadRegions, updateRoadRegions, type RoadRegion } from '../../../../view/shared/road/region';
import { CommandType, type Corners, type GridState, type PlacedObject } from '../../../../core/model/types';
import { type EditorEvents } from '../../../../state/editing/events';
import { RoadRegionCache, roadSurfaceTiles } from '../../../../view/shared/road/region-cache';
import { MAP_TEMPLATES } from '../../../../config/maps/index';
import { buildDesigned } from '../../../tools/generation/designer/_designed-map';
import { generateObjectId } from '../../../../core/model/object-id';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { createExecutor } from '../../../../state/executor';
import { ItemCategory } from '../../../../config/catalog/categories';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 24;
const ROADS = getPlaceableByCategory(ItemCategory.Road).slice(0, 2).map((r) => r.id);

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One comparable rendering of a region set: signature plus cells plus a ring sample. */
function portrait(regions: RoadRegion[]): string[] {
  return regions
    .map((r) => {
      const cells = r.cells.map((c) => `${c.x},${c.y}`).sort().join(';');
      const rings = r.rings
        .map((ring) => {
          // A ring is a cycle: where its point list starts depends on survivor order inside the
          // build, which nothing that draws it can observe. Compare from the smallest rotation.
          const pts = ring.points(0.5).map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`);
          let best = 0;
          for (let i = 1; i < pts.length; i++) {
            for (let k = 0; k < pts.length; k++) {
              const a = pts[(i + k) % pts.length]!;
              const b = pts[(best + k) % pts.length]!;
              if (a === b) continue;
              if (a < b) best = i;
              break;
            }
          }
          return pts.map((_, k) => pts[(best + k) % pts.length]).join(' ');
        })
        .sort()
        .join('#');
      return `${r.signature}\n${cells}\n${rings}`;
    })
    .sort();
}

describe('updateRoadRegions equals buildRoadRegions', () => {
  it('through a seeded walk of adds, removes and trims', () => {
    const state = makeState(SIZE, SIZE);
    const bus = new EventBus<EditorEvents>();
    const executor = createExecutor(state, createDefaultRegistry(), bus);
    const rng = mulberry(20260831);
    const roadObjs = (): PlacedObject[] => [...state.objects.values()];
    const flat = (x: number, y: number): number => y * SIZE + x;

    let prev: RoadRegion[] = [];
    for (let step = 0; step < 60; step++) {
      const dirty = new Set<number>();
      const burst = 1 + Math.floor(rng() * 4);
      for (let k = 0; k < burst; k++) {
        const x = 1 + Math.floor(rng() * (SIZE - 2));
        const y = 1 + Math.floor(rng() * (SIZE - 2));
        const standing = roadObjs().find((o) => o.position.x === x && o.position.y === y);
        const action = rng();
        if (standing && action < 0.35) {
          executor.execute({ type: CommandType.RemoveObject, objectId: standing.id });
          dirty.add(flat(x, y));
        } else if (standing && action < 0.55) {
          executor.execute({
            type: CommandType.TrimCorners, layer: 'road', x, y, objectId: standing.id,
            afterCorners: ['fan', 'square', 'square', 'square'],
          });
          dirty.add(flat(x, y));
        } else if (!standing) {
          const placed = executor.execute(placeObjectCommand({
            id: generateObjectId(), catalogId: ROADS[Math.floor(rng() * ROADS.length)]!,
            position: { x, y }, rotation: 0, elevation: 0,
          }));
          if (placed.success) dirty.add(flat(x, y));
        }
      }
      const all = roadObjs();
      const lookup = roadLookup(state);
      const incremental = updateRoadRegions(prev, dirty, all, lookup, SIZE);
      const full = buildRoadRegions(all, lookup);
      expect(portrait(incremental), `step ${step}`).toEqual(portrait(full));
      prev = incremental;
    }
    expect(roadObjs().length).toBeGreaterThan(20);
  });

  it('answers the full build where nothing is known', () => {
    const state = makeState(SIZE, SIZE);
    const executor = makeExecutor(state);
    for (let x = 3; x < 8; x++) {
      executor.execute(placeObjectCommand({
        id: generateObjectId(), catalogId: ROADS[0]!, position: { x, y: 5 }, rotation: 0, elevation: 0,
      }));
    }
    const all = [...state.objects.values()];
    const lookup = roadLookup(state);
    expect(portrait(updateRoadRegions(null, null, all, lookup, SIZE)))
      .toEqual(portrait(buildRoadRegions(all, lookup)));
  });

  it('on a generated planet, through the cache both views keep', () => {
    const state: GridState = buildDesigned(12345, MAP_TEMPLATES['hexia']!, { richness: 1 }).state;
    const executor = createExecutor(state, createDefaultRegistry());
    const trims: Corners[] = [
      ['fan', 'square', 'square', 'square'], ['square', 'fan', 'square', 'square'],
      ['square', 'square', 'fan', 'square'], ['square', 'square', 'square', 'fan'],
      ['tri-NW', 'square', 'square', 'square'],
    ];
    const edits: ((o: PlacedObject) => boolean)[] = [
      (o) => executor.execute({ type: CommandType.RemoveObject, objectId: o.id }).success,
      (o) => trims.some((c) => executor.execute({
        type: CommandType.TrimCorners, x: o.position.x, y: o.position.y, layer: 'road', objectId: o.id,
        afterCorners: c,       }).success),
      (o) => {
        const lookup = roadLookup(state);
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const x = o.position.x + dx!, y = o.position.y + dy!;
          return !lookup(x, y) && executor.execute({
            type: CommandType.PlaceObject,
            object: { id: generateObjectId(), catalogId: o.catalogId, position: { x, y }, rotation: 0, elevation: o.elevation },
          }).success;
        });
      },
    ];

    const initial = roadSurfaceTiles(state);
    expect(initial.length).toBeGreaterThan(500);
    const cache = new RoadRegionCache();
    cache.regionsFor(state, initial, roadLookup(state));
    let applied = 0;
    const stride = Math.max(1, Math.floor(initial.length / 60));
    for (let k = 0; k < initial.length; k += stride) {
      for (const [kind, edit] of edits.entries()) {
        const target = state.objects.get(initial[k]!.id);
        if (!target) continue;
        const start = executor.beginStroke();
        const ok = edit(target);
        start.commit();
        if (ok) applied++;
        const all = roadSurfaceTiles(state);
        const lookup = roadLookup(state);
        const incremental = cache.regionsFor(state, all, lookup);
        expect(portrait(incremental), `road ${k} edit ${kind}`).toEqual(portrait(buildRoadRegions(all, lookup)));
      }
    }
    expect(applied).toBeGreaterThan(50);
  });
});
