// @vitest-environment jsdom
/** Surface prints over roads in 2D: every print paints above every road it coats, whichever was drawn first, on the ground and on a raised layer, as the 3D view orders them. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TerrainType, type GridState, type PlacedObject } from '../../../../core/model/types';
import { coatingLayer } from '../../../../core/model/traits';
import { makeExecutor, makeState, placeCmd, setTerrain } from '../../../_support/map-state';
import { ObjectLayer } from '../../../../view/map2d/layers/object-layer';
import { getCatalogItem, getRoadMaterials } from '../../../../state/catalog';
import { roadMaterialSettled } from '../../../../view/shared/road/material';
import { buildRoadTrimMeshes } from '../../../../view/map3d/geometry/road-mesh';

vi.mock('../../../../view/shared/road/material-texture', () => ({
  roadMaterialTexture: () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    return canvas;
  },
}));

const ROADS = getRoadMaterials(false).filter((i) => !i.disabled);
const PRINTS = getRoadMaterials(true).filter((i) => !i.disabled);
/** One row per road: a run under one cell per print, a blank row between runs. */
const WIDTH = PRINTS.length + 2;
const HEIGHT = ROADS.length * 2 + 1;

const roadTile = (catalogId: string, x: number, y: number): PlacedObject => ({
  id: `road-${catalogId}-${x}`, catalogId, position: { x, y }, rotation: 0, elevation: 0,
});
const printTile = (catalogId: string, road: string, x: number, y: number): PlacedObject => ({
  id: `print-${catalogId}-on-${road}`, catalogId, position: { x, y }, rotation: 90, elevation: 0,
});

/** Every road in its own row, every print laid on every road, placed through the rules. */
function paintedMap(elevation: number): { state: GridState; roads: PlacedObject[]; prints: PlacedObject[] } {
  const state = makeState(WIDTH, HEIGHT);
  if (elevation > 0) for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) setTerrain(state, x, y, TerrainType.Mountain, elevation);
  const executor = makeExecutor(state);
  const roads: PlacedObject[] = [];
  const prints: PlacedObject[] = [];
  ROADS.forEach((road, r) => {
    for (let x = 1; x <= PRINTS.length; x++) roads.push(roadTile(road.id, x, 1 + r * 2));
  });
  PRINTS.forEach((print, p) => ROADS.forEach((road, r) => prints.push(printTile(print.id, road.id, 1 + p, 1 + r * 2))));
  for (const obj of [...roads, ...prints]) {
    const result = executor.execute(placeCmd({ ...obj, elevation }));
    expect(result.errors, `${obj.id} is placeable`).toEqual([]);
  }
  return { state, roads, prints };
}

/** The layer's display list in paint order: each drawn road surface by its material, each print by its object id. */
function paintOrder(layer: ObjectLayer): string[] {
  const regions = (layer as unknown as { roads: { regionGfx: Map<string, { g: PIXI.Container; material: string }> } }).roads.regionGfx;
  const surfaceOf = new Map([...regions.values()].map((e) => [e.g as PIXI.DisplayObject, e.material]));
  const out: string[] = [];
  const walk = (node: PIXI.DisplayObject): void => {
    const surface = surfaceOf.get(node);
    if (surface) { out.push(`road:${surface}`); return; }
    if (node.name?.startsWith('print-')) { out.push(node.name); return; }
    if (!(node instanceof PIXI.Container)) return;
    if (node.sortableChildren) node.sortChildren();
    for (const child of node.children) walk(child);
  };
  walk(layer.container);
  return out;
}

/** Each print that paints under the road it lies on, as `print on road`. */
function buriedPrints(layer: ObjectLayer, prints: readonly PlacedObject[]): string[] {
  const order = paintOrder(layer);
  const buried: string[] = [];
  for (const p of prints) {
    const road = p.id.slice(p.id.indexOf('-on-') + 4);
    const printAt = order.indexOf(p.id);
    expect(printAt, `${p.id} is drawn`).toBeGreaterThanOrEqual(0);
    const roadAt = order.indexOf(`road:${road}`);
    expect(roadAt, `${road} is drawn`).toBeGreaterThanOrEqual(0);
    if (printAt < roadAt) buried.push(`${p.catalogId} on ${road}`);
  }
  return buried;
}

beforeAll(() => roadMaterialSettled());

describe.each([0, 1])('prints over roads on layer %i', (elevation) => {
  it('every catalog road and print is in the sweep', () => {
    expect(ROADS.length).toBeGreaterThan(0);
    expect(PRINTS.length).toBeGreaterThan(0);
    for (const road of ROADS) expect(coatingLayer(road)).toBeLessThan(coatingLayer(PRINTS[0]));
  });

  it('paints every print above its road when the prints come after the roads', () => {
    const { state, roads, prints } = paintedMap(elevation);
    const layer = new ObjectLayer({ state: () => state, requestRender: () => {} });
    layer.addObjects(roads);
    layer.flushRoadRegions();
    layer.addObjects(prints);
    layer.flushRoadRegions();
    expect(buriedPrints(layer, prints)).toEqual([]);
  });

  it('paints every print above its road when the map loads whole', () => {
    const { state, prints } = paintedMap(elevation);
    const layer = new ObjectLayer({ state: () => state, requestRender: () => {} });
    layer.sync(state.objects);
    layer.flushRoadRegions();
    expect(buriedPrints(layer, prints)).toEqual([]);
  });

  it('keeps every print above its road after the road is redrawn', () => {
    const { state, roads, prints } = paintedMap(elevation);
    const layer = new ObjectLayer({ state: () => state, requestRender: () => {} });
    layer.addObjects(prints);
    layer.flushRoadRegions();
    layer.addObjects(roads);
    layer.flushRoadRegions();
    expect(buriedPrints(layer, prints)).toEqual([]);
  });

  it('3D draws every print as a decal over the roads', () => {
    const { state } = paintedMap(elevation);
    const parts = buildRoadTrimMeshes(state);
    for (const print of PRINTS) {
      const part = parts.find((p) => p.material === print.id);
      expect(part, `${print.id} has a 3D decal`).toBeDefined();
      expect(part!.mesh.index.length / 6, 'one quad per road it lies on').toBe(ROADS.length);
    }
    for (const road of ROADS) expect(parts.some((p) => p.material === road.id), `${road.id} has a 3D surface`).toBe(true);
    expect(getCatalogItem(PRINTS[0]!.id)?.surfacePrint).toBeDefined();
  });
});
