// @vitest-environment jsdom
/** Road surfaces in 2D: material art phased at the map origin across regions and band windows, and cached surfaces repainting when tile art or the band clipper arrives. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import type { GridState, PlacedObject } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { ObjectLayer } from '../../../../view/map2d/layers/object-layer';
import { getCatalogItem } from '../../../../state/catalog';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { roadPatternRepeat } from '../../../../view/shared/road/pattern';
import { roadMaterialSettled } from '../../../../view/shared/road/material';

const fallback = vi.hoisted(() => new Set<string>());
vi.mock('../../../../state/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../state/catalog')>();
  return { ...actual, getCatalogItem: (id: string) => {
    const item = actual.getCatalogItem(id);
    return item && fallback.has(id) ? { ...item, roadMaterial: undefined } : item;
  } };
});

vi.mock('../../../../view/shared/road/material-texture', () => ({
  roadMaterialTexture: () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    return canvas;
  },
}));

// jsdom never decodes an Image, so the real helper can never hand back a canvas. Stand in for the
// load: `waiting` collects the arrival callbacks the layer registers, `canvas` is the art once it
// has "loaded".
const art = vi.hoisted(() => ({ waiting: [] as Array<() => void>, canvas: null as HTMLCanvasElement | null }));
vi.mock('../../../../view/shared/road/tile-texture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../view/shared/road/tile-texture')>();
  return {
    ...actual,
    roadTileCanvas: (_url: string, onReady?: () => void): HTMLCanvasElement | undefined => {
      if (art.canvas) return art.canvas;
      if (onReady) art.waiting.push(onReady);
      return undefined;
    },
  };
});

const road = (catalogId: string, x: number): PlacedObject => ({
  id: `r-${catalogId}-${x}`, catalogId, position: { x, y: 2 }, rotation: 0, elevation: 0,
});

/** A map holding exactly the given road tiles, drawn by a fresh layer that reads it. */
function layerWith(objs: PlacedObject[]): { layer: ObjectLayer; state: GridState } {
  const state = makeState(20, 20);
  for (const o of objs) state.objects.set(o.id, o);
  const layer = new ObjectLayer({ state: () => state, requestRender: () => {} });
  layer.addObjects(objs);
  layer.flushRoadRegions();
  return { layer, state };
}

type DrawnSurfaces = Map<string, { g: PIXI.Container }>;
const drawnSurfaces = (layer: ObjectLayer): DrawnSurfaces =>
  (layer as unknown as { roads: { regionGfx: DrawnSurfaces } }).roads.regionGfx;

/** Every Graphics the layer draws its surfaces with: one per unbanded surface, one per band window otherwise. */
function regionGraphics(layer: ObjectLayer): PIXI.Graphics[] {
  return [...drawnSurfaces(layer).values()].flatMap((e) => (e.g instanceof PIXI.Graphics
    ? [e.g] : e.g.children.filter((c): c is PIXI.Graphics => c instanceof PIXI.Graphics)));
}

/** The fill textures of every region Graphics the layer holds. `Texture.WHITE` is what a plain
 *  `beginFill(colour)` records, so it reads as "no art here". */
function regionFills(layer: ObjectLayer): PIXI.Texture[] {
  const out: PIXI.Texture[] = [];
  for (const g of regionGraphics(layer)) for (const d of g.geometry.graphicsData) out.push(d.fillStyle.texture);
  return out;
}

/** The tile art, once it has "loaded". */
function loadedArt(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  return canvas;
}

const textured = (t: PIXI.Texture): boolean => t.baseTexture !== PIXI.Texture.WHITE.baseTexture;

beforeAll(() => roadMaterialSettled());
afterEach(() => { fallback.clear(); });

describe('road region fill', () => {
  it.each(['path-radiant-star-stone', 'path-overgrown-dirt', 'path-fan-shaped-brick'])('anchors %s art to the map across separated regions and a new connection', (id) => {
    const { layer, state } = layerWith([road(id, 3), road(id, 5)]);
    const period = roadPatternRepeat(getCatalogItem(id)!.roadMaterial!.edge.pattern);
    const assertPhase = () => {
      const graphics = regionGraphics(layer);
      expect(graphics.length).toBeGreaterThan(0);
      for (const g of graphics) for (const { fillStyle } of g.geometry.graphicsData) {
        expect(textured(fillStyle.texture)).toBe(true);
        const matrix = fillStyle.matrix!;
        expect(matrix.a * TILE_SIZE * period).toBeCloseTo(fillStyle.texture.width);
        expect(matrix.d).toBe(matrix.a);
        expect(matrix.tx).toBeCloseTo(0);
        expect(matrix.ty).toBeCloseTo(0);
      }
    };
    expect(drawnSurfaces(layer).size).toBe(2);
    assertPhase();
    const connection = road(id, 4);
    state.objects.set(connection.id, connection);
    layer.addObjects([connection]);
    layer.flushRoadRegions();
    expect(drawnSurfaces(layer).size).toBe(1);
    assertPhase();
  });

  it('draws in colour while the tile art has not arrived, and in the art once it has', () => {
    fallback.add('path-cobblestone');
    art.canvas = null;
    art.waiting = [];
    const { layer } = layerWith([road('path-cobblestone', 3), road('path-cobblestone', 4)]);

    const fills = regionFills(layer);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.some(textured), 'colour until the art loads').toBe(false);
    expect(art.waiting.length, 'the layer asked to be told when it lands').toBeGreaterThan(0);

    // The art lands: every surface of that material is dropped, and the rebuild redraws them.
    art.canvas = loadedArt();
    for (const cb of art.waiting) cb();
    layer.flushRoadRegions();

    const after = regionFills(layer);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(textured), 'every band of the surface, feather included').toBe(true);
    // World-aligned: the 128px art covers exactly one macro block, so two surfaces of one
    // material cannot disagree on where the pattern starts.
    expect(after[0]!.baseTexture.wrapMode).toBe(PIXI.WRAP_MODES.REPEAT);
  });

  it('splits by material, so two surfaces on one map wear their own tiles', () => {
    art.canvas = loadedArt();
    art.waiting = [];
    const { layer } = layerWith([
      road('path-overgrown-dirt', 6), road('path-overgrown-dirt', 7),
      road('path-cobblestone', 10), road('path-cobblestone', 11),
    ]);

    const fills = regionFills(layer);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every(textured)).toBe(true);
    expect(new Set(fills.map((t) => t.baseTexture)).size, 'one base texture per material').toBe(2);
  });

  it('does not destroy a Graphics something above it already destroyed', () => {
    art.canvas = null;
    art.waiting = [];
    fallback.add('path-garden-stone');
    const { layer } = layerWith([road('path-garden-stone', 3), road('path-garden-stone', 4)]);
    // A teardown destroys the nodes from above. Pixi nulls the geometry on the first destroy, so a
    // second one throws — and this drop runs inside the image's onload.
    for (const g of regionGraphics(layer)) g.destroy();

    art.canvas = loadedArt();
    expect(() => { for (const cb of art.waiting) cb(); }).not.toThrow();
    layer.flushRoadRegions();
    expect(regionFills(layer).every(textured)).toBe(true);
  });

  it('a torn-down layer ignores its arrival, so the next layer waiting on that art still repaints', () => {
    art.canvas = null;
    art.waiting = [];
    fallback.add('path-blue-board');
    const { layer: gone } = layerWith([road('path-blue-board', 3), road('path-blue-board', 4)]);
    const goneRegions = regionGraphics(gone).length;
    gone.container.destroy({ children: true }); // what MapRenderer.destroy / a finished capture does
    const { layer: live } = layerWith([road('path-blue-board', 8), road('path-blue-board', 9)]);

    // One loop over the url's subscribers, exactly as the texture helper runs them: a throw in the
    // torn-down layer's callback would take the live layer's repaint with it.
    art.canvas = loadedArt();
    expect(() => { for (const cb of art.waiting) cb(); }).not.toThrow();
    // It also starts no rebuild it cannot finish: dropping its entries would have the queued
    // refresh add fresh Graphics to containers that no longer exist.
    expect(regionGraphics(gone)).toHaveLength(goneRegions);
    live.flushRoadRegions();
    expect(regionFills(live).every(textured)).toBe(true);
  });
});
