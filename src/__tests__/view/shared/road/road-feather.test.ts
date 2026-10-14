import { describe, expect, it } from 'vitest';
import { roadFeatherOutline } from '../../../../view/shared/road/feather';
import { buildRoadRegions } from '../../../../view/shared/road/region';
import { CANONICAL_ROAD_STATES } from '../../../../core/domain/edge-cut/road-cut-states';
import { ROAD_FEATHER, roadBodyPoints } from '../../../../view/shared/road/shape';
import type { Corners, PlacedObject } from '../../../../core/model/types';

const road = (x: number, y: number, corners?: Corners): PlacedObject => ({
  id: `${x},${y}`, catalogId: 'path-overgrown-dirt', position: { x, y }, rotation: 0, elevation: 0, corners,
});
const regions = (objects: PlacedObject[]) => buildRoadRegions(objects,
  (x, y) => objects.find((o) => o.position.x === x && o.position.y === y) ?? null);

describe('road feather contours', () => {
  it('rounds an outer corner inside the painted tile while preserving the opaque core', () => {
    const ring = regions([road(0, 0)])[0]!.rings[0]!;
    const outline = roadFeatherOutline(ring.points);
    const outer = outline(0), core = outline(ROAD_FEATHER);
    const corner = outer.filter(([x, y]) => x <= ROAD_FEATHER && y <= ROAD_FEATHER);
    expect(corner.length).toBeGreaterThan(4);
    for (const [x, y] of corner) expect(Math.hypot(x - ROAD_FEATHER, y - ROAD_FEATHER)).toBeCloseTo(ROAD_FEATHER, 8);
    expect(new Set(core.map((p) => p.join(',')))).toEqual(new Set(ring.points(ROAD_FEATHER).map((p) => p.join(','))));
    expect(core).toHaveLength(outer.length);
  });

  it('keeps the straight sides of a connected path continuous', () => {
    const ring = regions([road(0, 0), road(1, 0), road(2, 0)])[0]!.rings[0]!;
    const points = roadFeatherOutline(ring.points)(ROAD_FEATHER / 2);
    const top = points.filter(([x, y]) => x >= 0.5 && x <= 2.5 && y < 0.5);
    expect(top.length).toBeGreaterThan(0);
    for (const [, y] of top) expect(y).toBeCloseTo(ROAD_FEATHER / 2, 9);
  });

  it('preserves the inward fade around holes', () => {
    const objects: PlacedObject[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) objects.push(road(x, y));
    const hole = regions(objects)[0]!.rings.find((ring) => ring.points(0).every(([x, y]) => x >= 1 && x <= 2 && y >= 1 && y <= 2))!;
    const outline = roadFeatherOutline(hole.points);
    for (const inset of [0, ROAD_FEATHER / 2, ROAD_FEATHER]) expect(outline(inset)).toEqual(hole.points(inset));
  });

  it('keeps a narrow wedge shrinking throughout its fade without an inverted core', () => {
    const ring = regions([road(0, 0, CANONICAL_ROAD_STATES[5])])[0]!.rings[0]!;
    const outline = roadFeatherOutline(ring.points);
    let previous = Infinity;
    for (let i = 0; i <= 24; i++) {
      const points = outline(ROAD_FEATHER * i / 24);
      const area = Math.abs(points.reduce((sum, p, k) => {
        const next = points[(k + 1) % points.length]!;
        return sum + p[0] * next[1] - next[0] * p[1];
      }, 0)) / 2;
      expect(area).toBeLessThan(previous);
      previous = area;
    }
  });

  it('keeps non-fading cell joins square during a group animation', () => {
    const objects = [road(0, 0), road(1, 0)];
    const lookup = (x: number, y: number) => objects.find((o) => o.position.x === x && o.position.y === y) ?? null;
    const outline = roadFeatherOutline((t) => roadBodyPoints(lookup, objects[0]!, { x: 0, y: 0, w: 1, h: 1 }, t));
    expect(outline(0)).toContainEqual([1, 0]);
    expect(outline(0)).toContainEqual([1, 1]);
    expect(outline(ROAD_FEATHER)).toContainEqual([1, ROAD_FEATHER]);
    expect(outline(ROAD_FEATHER)).toContainEqual([1, 1 - ROAD_FEATHER]);
  });

  it.each(CANONICAL_ROAD_STATES.map((corners, i) => [i, corners] as const))('keeps cut %i contours inside the tile with stable vertex counts', (_, corners) => {
    const ring = regions([road(0, 0, corners)])[0]!.rings[0]!;
    const outline = roadFeatherOutline(ring.points);
    const count = outline(0).length;
    for (let i = 0; i <= 12; i++) {
      const points = outline(ROAD_FEATHER * i / 12);
      expect(points).toHaveLength(count);
      for (const point of points) for (const coordinate of point) {
        expect(coordinate).toBeGreaterThanOrEqual(-1e-8);
        expect(coordinate).toBeLessThanOrEqual(1 + 1e-8);
      }
    }
  });
});
