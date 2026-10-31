/**
 * A road surface feathers as one region: connected same-material tiles, plus the fills they feed into
 * foreign cut cells, trace one outline whose inset is the fade, so no cell line inside a surface shows.
 */
import { describe, it, expect } from 'vitest';
import { buildRoadRegions, type RoadRegion } from '../../../../view/shared/road/region';
import { ROAD_FEATHER, type RoadPt } from '../../../../view/shared/road/shape';
import { CANONICAL_ROAD_STATES } from '../../../../core/domain/edge-cut/road-cut-states';
import { type Corners, type PlacedObject } from '../../../../core/model/types';
import { copyCorners } from '../../../../core/model/corners';

function world(catalogId: string, x: number, y: number, corners?: Corners): PlacedObject {
  return {
    id: `r-${catalogId}-${x}-${y}`, catalogId, position: { x, y }, rotation: 0, elevation: 0,
    ...(corners ? { corners: copyCorners(corners) } : {}),
  };
}

function regionsOf(objs: PlacedObject[]): RoadRegion[] {
  const roads = (x: number, y: number): PlacedObject | null =>
    objs.find((o) => o.position.x === x && o.position.y === y) ?? null;
  return buildRoadRegions(objs, roads);
}

const ringArea = (pts: RoadPt[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

describe('road regions', () => {
  it('a straight run is one region with one rectangular outline', () => {
    const regions = regionsOf([world('path-overgrown-dirt', 0, 0), world('path-overgrown-dirt', 1, 0), world('path-overgrown-dirt', 2, 0)]);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.rings).toHaveLength(1);
    const outline = regions[0]!.rings[0]!.points(0);
    expect(Math.abs(ringArea(outline))).toBeCloseTo(3, 9);
    const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 3]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 1]);
    const core = regions[0]!.rings[0]!.points(ROAD_FEATHER);
    expect(core).toHaveLength(outline.length);
    expect(Math.abs(ringArea(core))).toBeCloseTo((3 - 2 * ROAD_FEATHER) * (1 - 2 * ROAD_FEATHER), 9);
  });

  it('two materials never join', () => {
    const regions = regionsOf([world('path-overgrown-dirt', 0, 0), world('path-garden-stone', 1, 0)]);
    expect(regions).toHaveLength(2);
  });

  it('an L-bend wraps its inner corner with a fan instead of a notch', () => {
    const regions = regionsOf([
      world('path-overgrown-dirt', 0, 0), world('path-overgrown-dirt', 1, 0), world('path-overgrown-dirt', 1, 1),
    ]);
    expect(regions).toHaveLength(1);
    const ring = regions[0]!.rings[0]!;
    const at0 = ring.points(0);
    const atF = ring.points(ROAD_FEATHER);
    expect(atF).toHaveLength(at0.length);
    // At t = 0 several fan vertices share the inner corner (1,1); inset, they open into an arc.
    const fan = at0.map((p, i) => [p, i] as const).filter(([p]) => Math.hypot(p[0] - 1, p[1] - 1) < 1e-9);
    expect(fan.length).toBeGreaterThan(2);
    for (const [, i] of fan) {
      expect(Math.hypot(atF[i]![0] - 1, atF[i]![1] - 1)).toBeCloseTo(ROAD_FEATHER, 9);
    }
  });

  it('a fed fan cell joins the feeder surface: no boundary on their shared cell lines', () => {
    // A dirt run ending in a BR fan at (2,0), wrapped by stone at (3,0) and (2,1).
    const objs = [
      world('path-overgrown-dirt', 0, 0), world('path-overgrown-dirt', 1, 0),
      world('path-overgrown-dirt', 2, 0, copyCorners(CANONICAL_ROAD_STATES[1]!)),
      world('path-garden-stone', 3, 0), world('path-garden-stone', 2, 1),
    ];
    const regions = regionsOf(objs);
    const stone = regions.find((r) => r.material === 'path-garden-stone')!;
    expect(stone.members.map((m) => m.id).sort()).toEqual(['r-path-garden-stone-2-1', 'r-path-garden-stone-3-0']);
    expect(stone.cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(['2,0', '2,1', '3,0']);
    expect(stone.rings).toHaveLength(1);
    const outline = stone.rings[0]!.points(0);
    // Inside the fan cell the stone's boundary is the fan's arc, radius 1 about (2,0).
    expect(outline.some((p) => Math.abs(Math.hypot(p[0] - 2, p[1] - 0) - 1) < 1e-6)).toBe(true);
    // No outline vertex sits strictly between the fed cell and its feeders.
    const onSeam = outline.filter((p) =>
      (Math.abs(p[0] - 3) < 1e-9 && p[1] > 1e-9 && p[1] < 1 - 1e-9)
      || (Math.abs(p[1] - 1) < 1e-9 && p[0] > 2 + 1e-9 && p[0] < 3 - 1e-9));
    expect(onSeam).toHaveLength(0);
    // The dirt's outline in the same cell is the same arc.
    const dirt = regions.find((r) => r.material === 'path-overgrown-dirt')!;
    expect(dirt.rings[0]!.points(0).some((p) => Math.abs(Math.hypot(p[0] - 2, p[1] - 0) - 1) < 1e-6)).toBe(true);
  });

  it('a ring of tiles around a gap keeps the gap as a hole that fades like any boundary', () => {
    const objs: PlacedObject[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) {
      if (x === 1 && y === 1) continue;
      objs.push(world('path-garden-stone', x, y));
    }
    const regions = regionsOf(objs);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.rings).toHaveLength(2);
    const areas = regions[0]!.rings.map((r) => Math.abs(ringArea(r.points(0)))).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(1, 9); // the hole
    expect(areas[1]).toBeCloseTo(9, 9); // the outer edge
    // The hole's inset grows into the surface with rounded corners: the grown square less four
    // corner cuts, slightly under because the fan's chords approximate the arcs.
    const hole = regions[0]!.rings.find((r) => Math.abs(ringArea(r.points(0))) < 2)!;
    const grown = (1 + 2 * ROAD_FEATHER) ** 2 - (4 - Math.PI) * ROAD_FEATHER ** 2;
    const area = Math.abs(ringArea(hole.points(ROAD_FEATHER)));
    expect(area).toBeGreaterThan(grown - 0.01);
    expect(area).toBeLessThanOrEqual(grown + 1e-9);
  });

  it('two lobes touching at a corner stay one traceable region without crossing the pinch', () => {
    const cells: [number, number][] = [
      [0, 0], [1, 1], // diagonal pair
      [0, 1], // joins them into one component
    ];
    const regions = regionsOf(cells.map(([x, y]) => world('path-garden-stone', x, y)));
    expect(regions).toHaveLength(1);
    const rings = regions[0]!.rings;
    const total = rings.reduce((s, r) => s + Math.abs(ringArea(r.points(0))), 0);
    expect(total).toBeCloseTo(3, 9);
    // Consecutive points never jump more than a cell.
    for (const ring of rings) {
      const pts = ring.points(0);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('the signature answers for the whole outline: a foreign cut changing reshapes it', () => {
    // Squaring the dirt fan takes away the stone's fill without changing its members; a renderer
    // caching on the signature must see the change.
    const scene = (corners?: Corners): RoadRegion => {
      const objs = [
        world('path-overgrown-dirt', 0, 0), world('path-overgrown-dirt', 1, 0, corners),
        world('path-garden-stone', 2, 0), world('path-garden-stone', 2, 1), world('path-garden-stone', 1, 1),
      ];
      return regionsOf(objs).find((r) => r.material === 'path-garden-stone')!;
    };
    const fed = scene(copyCorners(CANONICAL_ROAD_STATES[1]!));
    const squared = scene(undefined);
    expect(fed.members.map((m) => m.id).sort()).toEqual(squared.members.map((m) => m.id).sort());
    expect(fed.signature).not.toBe(squared.signature);
  });

  it('an edge cut never bends or tears the rest of the outline', () => {
    // A fan fed on one side: untrimmed shallow-angle arc points would cross back over the straight
    // edge's offset.
    const objs = [
      world('path-overgrown-dirt', 0, 0), world('path-overgrown-dirt', 1, 0),
      world('path-overgrown-dirt', 2, 0, copyCorners(CANONICAL_ROAD_STATES[1]!)),
      world('path-garden-stone', 3, 0), world('path-garden-stone', 4, 0),
    ];
    const segsCross = (a: RoadPt, b: RoadPt, c: RoadPt, d: RoadPt): boolean => {
      const o = (p: RoadPt, q: RoadPt, r: RoadPt): number =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
      return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
    };
    for (const region of regionsOf(objs)) {
      for (const ring of region.rings) {
        for (const t of [0.1, ROAD_FEATHER]) {
          const pts = ring.points(t);
          for (let i = 0; i < pts.length; i++) {
            for (let j = i + 2; j < pts.length; j++) {
              if (i === 0 && j === pts.length - 1) continue;
              expect(
                segsCross(pts[i]!, pts[(i + 1) % pts.length]!, pts[j]!, pts[(j + 1) % pts.length]!),
                `${region.material} t=${t}: segment ${i} crosses ${j}`,
              ).toBe(false);
            }
          }
        }
      }
    }
    // Every inset point lies on a straight edge's parallel offset or on the fan's concentric arc.
    const dirt = regionsOf(objs).find((r) => r.material === 'path-overgrown-dirt')!;
    const F = ROAD_FEATHER;
    for (const p of dirt.rings[0]!.points(F)) {
      const onNorth = Math.abs(p[1] - F) < 1e-9;
      const onSouth = Math.abs(p[1] - (1 - F)) < 1e-9;
      const onWest = Math.abs(p[0] - F) < 1e-9;
      const onArc = Math.abs(Math.hypot(p[0] - 2, p[1]) - (1 - F)) < 1e-9;
      expect(onNorth || onSouth || onWest || onArc, `(${p[0]}, ${p[1]}) off the ideal outline`).toBe(true);
    }
  });

  it('levels stay apart: the same material at different elevations is two surfaces', () => {
    const a = world('path-garden-stone', 0, 0);
    const b = world('path-garden-stone', 1, 0);
    b.elevation = 2;
    expect(regionsOf([a, b])).toHaveLength(2);
  });
});
