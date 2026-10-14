import { beforeAll, describe, expect, it } from 'vitest';
import earcut, { flatten, deviation } from 'earcut';
import {
  roadBandLayout, roadMaterialPatches as buildRoadMaterial, roadMaterialSettled, type RoadMaterialPatch,
} from '../../../../view/shared/road/material';
import { buildRoadRegions } from '../../../../view/shared/road/region';
import { CANONICAL_ROAD_STATES } from '../../../../core/domain/edge-cut/road-cut-states';
import { type PlacedObject, type Rotation } from '../../../../core/model/types';
import { copyCorners } from '../../../../core/model/corners';
import type { RoadPt } from '../../../../view/shared/road/shape';
import { roadFeatherOutline } from '../../../../view/shared/road/feather';
import { getCatalogItem } from '../../../../state/catalog';
import { buildRoadTrimMeshes } from '../../../../view/map3d/geometry/road-mesh';
import { makeState } from '../../../_support/map-state';
import { cellCornerWorld } from '../../../../view/map3d/geometry/coords';
import { roadEdgeJointCuts } from '../../../../view/shared/road/edge-joints';
import type { RoadMaterialSpec } from '../../../../config/catalog/road-material';
import { PLACEMENT_GRID } from '../../../../core/game/profile';

const spec = getCatalogItem('path-urban-asphalt')!.roadMaterial!;
const stripe = spec.layers[2]!.color;
const asphalt = spec.layers[1]!.color;
const tile = (x: number, y: number): PlacedObject => ({
  id: `${x},${y}`, catalogId: 'path-urban-asphalt', position: { x, y }, rotation: 0, elevation: 0,
});
const rectangle = (w: number, h: number): PlacedObject[] =>
  Array.from({ length: w * h }, (_, i) => tile(i % w, Math.floor(i / w)));
function regions(roads: PlacedObject[]) {
  const byCell = new Map(roads.map((road) => [road.id, road]));
  return buildRoadRegions(roads, (x, y) => byCell.get(`${x},${y}`) ?? null);
}
const material = (roads: PlacedObject[], finish: RoadMaterialSpec = spec): RoadMaterialPatch[] =>
  regions(roads).flatMap((region) => buildRoadMaterial(region, finish));

function inside(ring: RoadPt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function colorsAt(patches: RoadMaterialPatch[], x: number, y: number): string[] {
  return patches.filter((patch) => patch.polygons.some(([outer, ...holes]) =>
    inside(outer!, x, y) && !holes.some((hole) => inside(hole, x, y)))).map((patch) => patch.color);
}
function area(polygon: RoadPt[][]): number {
  return polygon.reduce((total, ring, index) => {
    const a = Math.abs(ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
    return total + (index ? -a : a);
  }, 0);
}

beforeAll(() => roadMaterialSettled());

describe('connected road materials', () => {
  it('keeps inlaid art and its world phase through cuts, holes and elevation changes', () => {
    const id = 'path-radiant-star-stone';
    const inlay = getCatalogItem(id)!.roadMaterial!;
    const state = makeState(20, 20);
    // The right half stands one coating level higher, so the surface splits at x = 3.
    const roads = rectangle(6, 6).filter((r) => r.id !== '3,3')
      .map((r) => ({ ...r, catalogId: id, elevation: r.position.x < 3 ? 1 : 2 }));
    roads[0]!.corners = ['fan', 'square', 'square', 'square'];
    for (const r of roads) state.objects.set(r.id, r);
    const split = regions(roads);
    expect(split.map((r) => r.elevation).sort()).toEqual([1, 2]);
    const patches = split.flatMap((r) => buildRoadMaterial(r, inlay));
    expect(colorsAt(patches, 3.5, 3.5)).toEqual([]);
    // Each level fades at its own outline, so the split line is no longer interior to one surface.
    expect(colorsAt(patches, 2.99, 1.5)).toEqual([]);
    expect(colorsAt(patches, 2.9, 1.5)).toEqual([inlay.edge.color]);
    expect(colorsAt(patches, 3.1, 1.5)).toEqual([inlay.edge.color]);
    expect(patches.every((p) => p.pattern === inlay.edge.pattern)).toBe(true);
    const parts = buildRoadTrimMeshes(state);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.icon).toBeUndefined();
    expect(parts[0]!.pattern).toBe(inlay.edge.pattern);
    const { mesh } = parts[0]!;
    const origin = cellCornerWorld(0, 0, state.template.width, state.template.height, PLACEMENT_GRID);
    let splitFades = false;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      expect(mesh.uv![i * 2]).toBeCloseTo(mesh.positions[i * 3]! - origin.x);
      expect(mesh.uv![i * 2 + 1]).toBeCloseTo(mesh.positions[i * 3 + 2]! - origin.z);
      const x = mesh.positions[i * 3]! - origin.x, z = mesh.positions[i * 3 + 2]! - origin.z;
      if (mesh.alpha![i] === 0 && Math.abs(x - 3) < 1e-9 && z >= 1 && z <= 2) splitFades = true;
    }
    expect(splitFades).toBe(true);
  });

  it('keeps edge joints unchanged when straight contours are subdivided', () => {
    const whole: RoadPt[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    const subdivided: RoadPt[] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
    const normalized = (ring: RoadPt[]) => roadEdgeJointCuts([ring], 0.3, 0.5, 0.02)
      .map((cut) => JSON.stringify(cut.map((p) => p.map((n) => +n.toFixed(8))))).sort();
    expect(normalized(subdivided)).toEqual(normalized(whole));
    expect(normalized([...subdivided].reverse())).toEqual(normalized([...whole].reverse()));
  });

  it('confines brick joints to outer and inner edging and joins corners diagonally', () => {
    const spec = getCatalogItem('path-wavy-terracotta')!.roadMaterial!;
    const road = regions(rectangle(7, 7).filter((r) => r.id !== '3,3'))[0]!;
    const patches = buildRoadMaterial(road, spec);
    const mortar = spec.edgeJoints!.color, edge = spec.edge.color;
    expect(colorsAt(patches, 1, 0.15)).toEqual([mortar]);
    expect(colorsAt(patches, 1.25, 0.15)).toEqual([edge]);
    expect(colorsAt(patches, 0.15, 0.15)).toEqual([mortar]);
    expect(colorsAt(patches, 6.85, 6.85)).toEqual([mortar]);
    expect(colorsAt(patches, 3.5, 2.85)).toEqual([mortar]);
    expect(colorsAt(patches, 3.25, 2.85)).toEqual([edge]);
    expect(colorsAt(patches, 3.5, 3.5)).toEqual([]);
    expect(colorsAt(patches, 1, 1)).toEqual([spec.layers[spec.layers.length - 1]!.color]);
    const withoutJoints = buildRoadMaterial(road, { ...spec, edgeJoints: undefined });
    const total = (parts: RoadMaterialPatch[]) => parts.flatMap((p) => p.polygons).reduce((sum, p) => sum + area(p), 0);
    expect(total(patches)).toBeCloseTo(total(withoutJoints), 4);
  });

  it('keeps narrow straight roads unmarked and wraps a wider road only at its perimeter', () => {
    for (const [w, h] of [[1, 8], [8, 1]]) {
      expect(material(rectangle(w!, h!)).filter((p) => p.color === stripe).flatMap((p) => p.polygons)).toEqual([]);
    }
    const patches = material(rectangle(4, 6));
    expect(colorsAt(patches, 0.55, 2.5)).toEqual([stripe]);
    expect(colorsAt(patches, 3.45, 2.5)).toEqual([stripe]);
    expect(colorsAt(patches, 2, 3)).toEqual([asphalt]);
    expect(colorsAt(patches, 1, 2)).toEqual([asphalt]);
  });

  it('wraps holes, follows notches and drops the erased surface', () => {
    const roads = rectangle(7, 7).filter((road) => road.id !== '3,3');
    const patches = material(roads);
    expect(colorsAt(patches, 3.5, 3.5)).toEqual([]);
    expect(colorsAt(patches, 3.5, 2.45)).toEqual([stripe]);
    expect(colorsAt(patches, 4.55, 3.5)).toEqual([stripe]);
    const opened = material(roads.filter((road) => road.position.x !== 3 || road.position.y < 3));
    expect(colorsAt(opened, 3.5, 5.5)).toEqual([]);
    expect(colorsAt(opened, 2.45, 5.5)).toEqual([stripe]);
  });

  it('splits markings when a connection becomes too narrow', () => {
    const roads = rectangle(8, 4).filter(({ position: { x, y } }) => x < 3 || x > 4 || y === 1);
    const patches = material(roads);
    expect(colorsAt(patches, 4, 1.5)).toEqual([asphalt]);
    expect(patches.find((p) => p.color === stripe)!.polygons).toHaveLength(2);
  });

  it.each(['path-urban-asphalt', 'path-overgrown-dirt', 'path-wavy-terracotta', 'path-fan-shaped-brick'])('preserves disjoint bands through every cut and facing for %s', (id) => {
    const spec = getCatalogItem(id)!.roadMaterial!;
    for (const corners of CANONICAL_ROAD_STATES) for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const road = { ...tile(0, 0), corners: corners ? copyCorners(corners) : undefined, rotation };
      const region = regions([road])[0]!;
      const total = material([road], spec).flatMap((patch) => patch.polygons).reduce((sum, polygon) => sum + area(polygon), 0);
      const core = region.rings.map((ring) => roadFeatherOutline(ring.points)(spec.feather));
      expect(total).toBeCloseTo(area(core), 3);
      for (const patch of material([road], spec)) for (const polygon of patch.polygons) {
        expect(area(polygon)).toBeGreaterThan(0);
        const data = flatten(polygon);
        const triangles = earcut(data.vertices, data.holes, data.dimensions);
        expect(deviation(data.vertices, data.holes, data.dimensions, triangles)).toBeLessThan(1e-6);
      }
    }
  });

  it('keeps material and elevation boundaries separate', () => {
    for (const separate of ['material', 'elevation']) {
      const roads = rectangle(2, 6);
      for (const road of roads) if (road.position.x === 1) {
        if (separate === 'material') road.catalogId = 'path-cobblestone';
        else road.elevation = 1;
      }
      const patches = regions(roads).filter((region) => region.material === 'path-urban-asphalt')
        .flatMap((region) => buildRoadMaterial(region, spec));
      expect(patches.filter((patch) => patch.color === stripe).flatMap((patch) => patch.polygons)).toEqual([]);
    }
  });

  it('reuses unchanged windows and refreshes only the windows a cut reaches', () => {
    const roads = rectangle(40, 4);
    const before = roadBandLayout(regions(roads)[0]!, spec).windows;
    expect(before.length).toBeGreaterThan(1);
    const original = before.map((w) => w.patches());
    expect(roadBandLayout(regions(roads)[0]!, spec).windows.map((w) => w.patches())).toEqual(original);
    roads.find((road) => road.id === '39,3')!.corners = ['square', 'square', 'square', 'fan'];
    const after = roadBandLayout(regions(roads)[0]!, spec).windows;
    expect(after.map((w) => w.key)).not.toEqual(before.map((w) => w.key));
    expect(after[0]!.key).toBe(before[0]!.key);
    expect(after[0]!.patches()).toBe(original[0]);
    const changed = after[after.length - 1]!.patches();
    expect(changed).not.toBe(original[original.length - 1]);
    expect(colorsAt(original.flat(), 39.4, 3.4)).toEqual([stripe]);
    expect(colorsAt(changed, 39.4, 3.4)).not.toEqual([stripe]);
  });

  it.each(['path-urban-asphalt', 'path-overgrown-dirt', 'path-wavy-terracotta', 'path-fan-shaped-brick'])('emits coplanar 3D bands with matching coverage and world UVs for %s', (id) => {
    const spec = getCatalogItem(id)!.roadMaterial!;
    const state = makeState(20, 20);
    const roads = rectangle(7, 7).filter((road) => road.id !== '3,3').map((road) => ({ ...road, catalogId: id }));
    for (const road of roads) state.objects.set(road.id, road);
    const parts = buildRoadTrimMeshes(state);
    expect(parts.every((part) => part.icon === undefined)).toBe(true);
    expect(parts.map((part) => part.pattern)).toContain(spec.edge.pattern);
    const origin = cellCornerWorld(0, 0, state.template.width, state.template.height, PLACEMENT_GRID);
    let coreArea = 0;
    for (const { mesh } of parts) {
      for (let i = 0; i < mesh.positions.length / 3; i++) {
        expect(mesh.uv![i * 2]).toBeCloseTo(mesh.positions[i * 3]! - origin.x);
        expect(mesh.uv![i * 2 + 1]).toBeCloseTo(mesh.positions[i * 3 + 2]! - origin.z);
      }
      expect(new Set(mesh.positions.filter((_, i) => i % 3 === 1)).size).toBe(1);
      for (let i = 0; i < mesh.index.length; i += 3) {
        const ids = mesh.index.slice(i, i + 3);
        if (ids.some((id) => mesh.alpha![id] !== 1)) continue;
        const [a, b, c] = ids.map((id) => [mesh.positions[id * 3]!, mesh.positions[id * 3 + 2]!] as RoadPt);
        coreArea += Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) / 2;
      }
    }
    const expectedArea = material(roads, spec).flatMap((p) => p.polygons).reduce((sum, polygon) => sum + area(polygon), 0);
    expect(coreArea).toBeCloseTo(expectedArea, 6);
  });
});
