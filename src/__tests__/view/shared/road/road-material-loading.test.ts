// @vitest-environment jsdom
/** The polygon clipper behind road material bands loads on first use: surfaces draw in their swatch colour until it arrives and redraw with their bands once it has. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedObject } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { getCatalogItem } from '../../../../state/catalog';
import { hexStringToNumber } from '../../../../core/base/color';
import * as clipperModule from 'clipper-lib';

// Each test imports the renderers afresh after a module reset, which is slow on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

// The clipper arrives when the test hands it over, never on the timing of a real chunk load.
const arrivals = vi.hoisted(() => [] as Array<{ resolve(lib: unknown): void; reject(error: Error): void }>);
vi.mock('../../../../view/shared/road/clipper-loader', () => ({
  loadClipper: () => new Promise((resolve, reject) => { arrivals.push({ resolve, reject }); }),
}));
const clipper = (clipperModule as { default?: unknown }).default ?? clipperModule;
/** Hand the clipper to the load in flight. */
function arrive(): void {
  expect(arrivals).toHaveLength(1);
  arrivals.shift()!.resolve(clipper);
}

vi.mock('../../../../view/shared/road/material-texture', () => ({
  roadMaterialTexture: () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    return canvas;
  },
}));

const ID = 'path-wavy-terracotta';
const item = getCatalogItem(ID)!;

function roadState() {
  const state = makeState(12, 12);
  for (let x = 2; x < 7; x++) for (let y = 2; y < 5; y++) {
    const road: PlacedObject = { id: `${x},${y}`, catalogId: ID, position: { x, y }, rotation: 0, elevation: 0 };
    state.objects.set(road.id, road);
  }
  return state;
}

beforeEach(() => { vi.resetModules(); arrivals.length = 0; });

describe('road material bands load on first use', () => {
  it('in 3D: the swatch colour first, then a rebuild request and the bands', async () => {
    const { roadMaterialSettled } = await import('../../../../view/shared/road/material');
    const { buildRoadTrimMeshes, RoadTrimCache } = await import('../../../../view/map3d/geometry/road-mesh');
    const { hexToRgb01 } = await import('../../../../view/map3d/draw/palette');
    const state = roadState();
    const ready = vi.fn();
    const cache = new RoadTrimCache(ready);
    const first = buildRoadTrimMeshes(state, undefined, undefined, cache);
    expect(first.map((p) => p.pattern)).toEqual([undefined]);
    const swatch = hexToRgb01(item.color!);
    expect(first[0]!.mesh.colors.slice(0, 3)).toEqual(swatch);
    expect(ready).not.toHaveBeenCalled();
    arrive();
    await roadMaterialSettled();
    expect(ready).toHaveBeenCalledTimes(1);
    const banded = buildRoadTrimMeshes(state, undefined, undefined, cache);
    expect(banded.map((p) => p.pattern)).toContain(item.roadMaterial!.edge.pattern);
  });

  it('in 2D: the swatch colour first, then the banded windows', async () => {
    const { roadMaterialSettled } = await import('../../../../view/shared/road/material');
    const { ObjectLayer } = await import('../../../../view/map2d/layers/object-layer');
    const state = roadState();
    const layer = new ObjectLayer({ state: () => state, requestRender: () => {} });
    layer.addObjects([...state.objects.values()]);
    layer.flushRoadRegions();
    const drawn = () => [...(layer as unknown as { roads: { regionGfx: Map<string, { g: PIXI.Container }> } }).roads.regionGfx.values()];
    expect(drawn()).toHaveLength(1);
    const unbanded = drawn()[0]!.g as PIXI.Graphics;
    expect(new Set(unbanded.geometry.graphicsData.map((d) => d.fillStyle.color))).toEqual(new Set([hexStringToNumber(item.color!)]));
    arrive();
    await roadMaterialSettled();
    layer.flushRoadRegions();
    const windows = drawn()[0]!.g.children as PIXI.Graphics[];
    expect(windows.length).toBeGreaterThan(0);
    const colors = new Set(windows.flatMap((g) => g.geometry.graphicsData.map((d) => d.fillStyle.color)));
    expect(colors.has(hexStringToNumber(item.roadMaterial!.edgeJoints!.color))).toBe(true);
  });

  it('a failed load draws the swatch, and the next request loads again and calls every waiting listener', async () => {
    const { roadMaterialReady, roadMaterialSettled } = await import('../../../../view/shared/road/material');
    const first = vi.fn();
    expect(roadMaterialReady(first)).toBe(false);
    arrivals.shift()!.reject(new Error('chunk failed'));
    await roadMaterialSettled().catch(() => {});
    expect(first).not.toHaveBeenCalled();
    expect(roadMaterialReady()).toBe(false);
    const second = vi.fn();
    expect(roadMaterialReady(second)).toBe(false);
    arrive();
    await roadMaterialSettled();
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
    expect(roadMaterialReady()).toBe(true);
  });

  it('in Lite: a classic script that registers the clipper', async () => {
    const { loadClipper } = await import('../../../../view/shared/road/clipper-loader-lite');
    const host = window as Window & { ClipperLib?: unknown };
    delete host.ClipperLib;
    const loading = loadClipper();
    const script = [...document.head.querySelectorAll('script')].pop()!;
    expect(script.src).toMatch(/clipper\.js/);
    const lib = { Clipper: class {} };
    host.ClipperLib = lib;
    script.onload!(new Event('load'));
    await expect(loading).resolves.toBe(lib);
    delete host.ClipperLib;
    script.remove();
  });
});
