/**
 * A path surface fills with its own tile art; a colour-only road (the dirt road) fills with its
 * colour, and so does a path whose art has not decoded yet.
 *
 * The second fact is the one with a mechanism behind it: a region's Graphics is cached by the
 * region's signature and never rebuilt while the map is unchanged, so the art arriving after the
 * first paint would otherwise never reach the surfaces already standing. `repaintMaterial` drops
 * the drawn surfaces of that material and lets the ordinary rebuild redraw them.
 */
import './_pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GridState, PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { ObjectLayer } from '../../canvas/map2d/layers/object-layer';
import { useEditorStore } from '../../state/store';

// jsdom never decodes an Image, so the real helper can never hand back a canvas. Stand in for the
// load: `waiting` collects the arrival callbacks the layer registers, `canvas` is the art once it
// has "loaded".
const art = vi.hoisted(() => ({ waiting: [] as Array<() => void>, canvas: null as HTMLCanvasElement | null }));
vi.mock('../../canvas/road-tile-texture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../canvas/road-tile-texture')>();
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

/** A map holding exactly the given road tiles, drawn by a fresh layer. It is the LIVE map, since
 *  that is the one a texture arriving later redraws. */
function layerWith(objs: PlacedObject[]): { layer: ObjectLayer; state: GridState } {
  const state = makeState(20, 20);
  for (const o of objs) state.objects.set(o.id, o);
  useEditorStore.setState({ gridState: state });
  const layer = new ObjectLayer();
  layer.addObjects(objs);
  layer.flushRoadRegions();
  return { layer, state };
}

/** The Graphics the layer currently holds one per drawn surface. */
function regionGraphics(layer: ObjectLayer): PIXI.Graphics[] {
  const gfx = (layer as unknown as { roadRegionGfx: Map<string, { g: PIXI.Graphics }> }).roadRegionGfx;
  return [...gfx.values()].map((e) => e.g);
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

afterEach(() => { useEditorStore.setState({ gridState: null }); });

describe('road region fill', () => {
  it('draws in colour while the tile art has not arrived, and in the art once it has', () => {
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
