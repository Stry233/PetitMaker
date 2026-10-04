/** The polygon clipper behind road material bands loads on first use: surfaces draw in their swatch colour until it arrives and redraw with their bands once it has. */
import './_pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { getCatalogItem } from '../../state/catalog';
import { hexStringToNumber } from '../../core/model/colors';

vi.mock('../../canvas/road-material-texture', () => ({
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

beforeEach(() => { vi.resetModules(); });

describe('road material bands load on first use', () => {
  it('in 3D: the swatch colour first, then a rebuild request and the bands', async () => {
    const { roadMaterialSettled } = await import('../../canvas/road-material');
    const { buildRoadTrimMeshes, RoadTrimCache } = await import('../../canvas/map3d/build/terrain-geometry');
    const { hexToRgb01 } = await import('../../canvas/map3d/core/palette');
    const state = roadState();
    const ready = vi.fn();
    const cache = new RoadTrimCache(ready);
    const first = buildRoadTrimMeshes(state, undefined, undefined, cache);
    expect(first.map((p) => p.pattern)).toEqual([undefined]);
    const swatch = hexToRgb01(item.color!);
    expect(first[0]!.mesh.colors.slice(0, 3)).toEqual(swatch);
    expect(ready).not.toHaveBeenCalled();
    await roadMaterialSettled();
    expect(ready).toHaveBeenCalledTimes(1);
    const banded = buildRoadTrimMeshes(state, undefined, undefined, cache);
    expect(banded.map((p) => p.pattern)).toContain(item.roadMaterial!.edge.pattern);
  });

  it('in 2D: the swatch colour first, then the banded windows', async () => {
    const { roadMaterialSettled } = await import('../../canvas/road-material');
    const { ObjectLayer } = await import('../../canvas/map2d/layers/object-layer');
    const { useEditorStore } = await import('../../state/store');
    const state = roadState();
    useEditorStore.setState({ gridState: state });
    const layer = new ObjectLayer();
    layer.addObjects([...state.objects.values()]);
    layer.flushRoadRegions();
    const drawn = () => [...(layer as unknown as { roadRegionGfx: Map<string, { g: PIXI.Container }> }).roadRegionGfx.values()];
    expect(drawn()).toHaveLength(1);
    const unbanded = drawn()[0]!.g as PIXI.Graphics;
    expect(new Set(unbanded.geometry.graphicsData.map((d) => d.fillStyle.color))).toEqual(new Set([hexStringToNumber(item.color!)]));
    await roadMaterialSettled();
    layer.flushRoadRegions();
    const windows = drawn()[0]!.g.children as PIXI.Graphics[];
    expect(windows.length).toBeGreaterThan(0);
    const colors = new Set(windows.flatMap((g) => g.geometry.graphicsData.map((d) => d.fillStyle.color)));
    expect(colors.has(hexStringToNumber(item.roadMaterial!.edgeJoints!.color))).toBe(true);
    useEditorStore.setState({ gridState: null });
  });

  it('in Lite: a classic script that registers the clipper', async () => {
    const { loadClipper } = await import('../../canvas/clipper-loader-lite');
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
