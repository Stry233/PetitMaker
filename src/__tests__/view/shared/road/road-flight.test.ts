// @vitest-environment jsdom
/** A road surface partly carried by a group tween draws the same surfaces in 2D and 3D, with the material's bands and fade width. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../view/shared/road/material-texture', () => ({
  roadMaterialTexture: () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    return canvas;
  },
}));

import type { PlacedObject } from '../../../../core/model/types';
import type { RoadPt } from '../../../../view/shared/road/shape';
import { makeState } from '../../../_support/map-state';
import { getCatalogItem } from '../../../../state/catalog';
import { roadLookup } from '../../../../state/object-index';
import { buildRoadRegions } from '../../../../view/shared/road/region';
import { roadMaterialPatches, roadMaterialSettled } from '../../../../view/shared/road/material';
import { carriedRoadSurfaces, standingRoadSurfaces } from '../../../../view/shared/road/flight';
import { buildRoadTrimMeshes } from '../../../../view/map3d/geometry/road-mesh';
import { hexToRgb01 } from '../../../../view/map3d/draw/palette';
import { hexStringToNumber } from '../../../../core/base/color';
import { ObjectLayer } from '../../../../view/map2d/layers/object-layer';

const ID = 'path-urban-asphalt';
const spec = getCatalogItem(ID)!.roadMaterial!;

beforeAll(() => roadMaterialSettled());

function block() {
  const state = makeState(20, 20);
  for (let y = 5; y < 9; y++) for (let x = 5; x < 10; x++) {
    const road: PlacedObject = { id: `${x},${y}`, catalogId: ID, position: { x, y }, rotation: 0, elevation: 0 };
    state.objects.set(road.id, road);
  }
  const carried = ['9,5', '9,6', '9,7', '9,8'];
  return { state, carried };
}

const area = (polygon: RoadPt[][]): number => polygon.reduce((total, ring, index) => {
  const a = Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  return total + (index ? -a : a);
}, 0);

describe('a partly carried road surface', () => {
  it('splits into standing surfaces at rest and one-tile surfaces for the carried members', () => {
    const { state, carried } = block();
    const roads = roadLookup(state);
    const [region] = buildRoadRegions([...state.objects.values()], roads);
    const standing = standingRoadSurfaces(region!, (id) => carried.includes(id), roads);
    expect(standing).toHaveLength(1);
    expect(standing[0]!.members.map((m) => m.id).sort()).toEqual(region!.members.map((m) => m.id).filter((id) => !carried.includes(id)).sort());
    const flying = carriedRoadSurfaces(state.objects.get('9,5')!, roads);
    expect(flying.map((r) => r.members.map((m) => m.id))).toEqual([['9,5']]);
  });

  it('keeps the bands in 3D: every band of the split surfaces at its own place', () => {
    const { state, carried } = block();
    const roads = roadLookup(state);
    const [region] = buildRoadRegions([...state.objects.values()], roads);
    const offsets = new Map(carried.map((id, i) => [id, { dx: 0.3 + 0.1 * i, dz: -0.2 * i }]));
    const parts = buildRoadTrimMeshes(state, undefined, offsets);
    const areaByColor = new Map<string, number>();
    for (const { mesh } of parts) {
      for (let i = 0; i < mesh.index.length; i += 3) {
        const ids = mesh.index.slice(i, i + 3);
        if (ids.some((id) => mesh.alpha![id] !== 1)) continue;
        const [a, b, c] = ids.map((id) => [mesh.positions[id * 3]!, mesh.positions[id * 3 + 2]!]);
        const color = ids.map((id) => mesh.colors.slice(id * 3, id * 3 + 3).map((v) => v.toFixed(4)).join(','))[0]!;
        const triangle = Math.abs((b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)) / 2;
        areaByColor.set(color, (areaByColor.get(color) ?? 0) + triangle);
      }
    }
    const surfaces = [
      ...standingRoadSurfaces(region!, (id) => carried.includes(id), roads),
      ...carried.flatMap((id) => carriedRoadSurfaces(state.objects.get(id)!, roads)),
    ];
    const expected = new Map<string, number>();
    for (const patch of surfaces.flatMap((s) => roadMaterialPatches(s, spec))) {
      const color = hexToRgb01(patch.color).map((v) => v.toFixed(4)).join(',');
      expected.set(color, (expected.get(color) ?? 0) + patch.polygons.reduce((sum, p) => sum + area(p), 0));
    }
    for (const [color, value] of expected) expect(areaByColor.get(color) ?? 0, color).toBeCloseTo(value, 6);
    // The carried tiles keep their inner finish, not just the edge colour.
    expect(expected.get(hexToRgb01(spec.layers[0]!.color).map((v) => v.toFixed(4)).join(','))).toBeGreaterThan(0);
  });

  it('draws the same surfaces in 2D, banded, with the carried tiles in their wrappers', () => {
    const { state, carried } = block();
    const layer = new ObjectLayer({ state: () => state, requestRender: () => {} });
    layer.addObjects([...state.objects.values()]);
    layer.flushRoadRegions();
    const roads = roadLookup(state);
    const [region] = buildRoadRegions([...state.objects.values()], roads);
    layer.animateGroupRotation({
      pivot: { x: 9.5, y: 7 }, sweepDeg: 90,
      members: carried.map((id) => ({ id, from: { x: state.objects.get(id)!.position.x + 0.5, y: state.objects.get(id)!.position.y + 0.5 }, spun: false })),
    });
    const drawn = (layer as unknown as { roads: { regionGfx: Map<string, unknown> } }).roads.regionGfx;
    expect([...drawn.keys()].sort()).toEqual(standingRoadSurfaces(region!, (id) => carried.includes(id), roads).map((r) => r.signature).sort());
    const objectMap = (layer as unknown as { objectMap: Map<string, PIXI.Container> }).objectMap;
    for (const id of carried) {
      const flight = objectMap.get(id)!.children.find((c): c is PIXI.Graphics => c instanceof PIXI.Graphics)!;
      const colors = new Set(flight.geometry.graphicsData.map((d) => d.fillStyle.color));
      for (const finish of [spec.edge, spec.layers[0]!]) expect(colors.has(hexStringToNumber(finish.color)), finish.color).toBe(true);
    }
  });
});
