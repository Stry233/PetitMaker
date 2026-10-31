// @vitest-environment jsdom
/**
 * A captured map (candidate cards, the restore offer) has its roads on it. A live view draws road
 * surfaces on a queued frame (`scheduleRoadRefresh`) that a capture never reaches, and a material's
 * tile art is cropped from its icon asynchronously; a surface drawn before it lands is a flat colour.
 */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GridState, PlacedObject, CatalogItem } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState } from '../../../_support/map-state';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { EventBus } from '../../../../core/commands/event-bus';

// jsdom decodes no image, so the tile art arrives only when `deliver` is called.
const art = vi.hoisted(() => {
  const state = {
    canvas: null as HTMLCanvasElement | null,
    waiting: [] as Array<() => void>,
    asked: [] as string[],
  };
  return state;
});
vi.mock('../../../../view/shared/road/surface-image', () => ({
  surfaceImage: () => art.canvas,
  surfaceImagesReady: (items: Iterable<CatalogItem | undefined>) => {
    for (const item of items) if (item) art.asked.push(item.id);
    return new Promise<void>(resolve => { if (art.canvas) resolve(); else art.waiting.push(resolve); });
  },
}));
vi.mock('../../../../view/shared/road/tile-texture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../view/shared/road/tile-texture')>();
  const roadTileCanvas = (url: string, onReady?: () => void): HTMLCanvasElement | undefined => {
    art.asked.push(url);
    if (art.canvas) return art.canvas;
    if (onReady) art.waiting.push(onReady);
    return undefined;
  };
  return {
    ...actual,
    roadTileCanvas,
    roadTileReady: (url: string): Promise<void> =>
      new Promise<void>((resolve) => { if (roadTileCanvas(url, resolve)) resolve(); }),
  };
});

/** Loads the tile art and hands it to everyone waiting on it. */
function deliver(): void {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  art.canvas = c;
  for (const cb of art.waiting.splice(0)) cb();
}

const road = (catalogId: string, x: number): PlacedObject => ({
  id: `r-${catalogId}-${x}`, catalogId, position: { x, y: 2 }, rotation: 0, elevation: 0,
});

function mapWith(objs: PlacedObject[]): GridState {
  const state = makeState(20, 20);
  for (const o of objs) state.objects.set(o.id, o);
  return state;
}

/**
 * Takes the picture and returns the road surfaces' fill textures as the stubbed rasterization saw
 * them; the capture destroys its world afterwards. A plain `beginFill(colour)` records `Texture.WHITE`.
 */
async function captureRoadFills(state: GridState): Promise<PIXI.Texture[]> {
  const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
  const gl = (renderer as unknown as { app: { renderer: Record<string, unknown> } }).app.renderer;
  let fills: PIXI.Texture[] | null = null;
  gl.generateTexture = (world: PIXI.Container) => {
    // Road surfaces are Graphics in the object layer; base and terrain are the world's other children.
    const objects = world.children[2] as PIXI.Container;
    const out: PIXI.Texture[] = [];
    const walk = (node: PIXI.Container): void => {
      if (node instanceof PIXI.Graphics) for (const d of node.geometry.graphicsData) out.push(d.fillStyle.texture);
      for (const child of node.children ?? []) walk(child as PIXI.Container);
    };
    walk(objects);
    fills = out;
    return { destroy: () => {} };
  };
  gl.extract = { canvas: () => document.createElement('canvas') };
  try {
    await renderer.captureState(state);
    expect(fills, 'the capture reached its rasterization').not.toBeNull();
    return fills!;
  } finally {
    renderer.destroy();
  }
}

const textured = (t: PIXI.Texture): boolean => t.baseTexture !== PIXI.Texture.WHITE.baseTexture;

beforeEach(() => { art.canvas = null; art.waiting = []; art.asked = []; });

describe('capturing a map that has roads on it', () => {
  it('draws the road surfaces into the picture rather than queueing them for a frame it never has', async () => {
    // The art is already in hand, so only the drawing is under test.
    deliver();
    const drawn = await captureRoadFills(mapWith([road('path-overgrown-dirt', 3), road('path-overgrown-dirt', 4)]));
    expect(drawn.length, 'a road surface was drawn').toBeGreaterThan(0);
  });

  it('waits for each path material\'s tile art, so a road is photographed in its art', async () => {
    const shot = captureRoadFills(mapWith([road('path-cobblestone', 3), road('path-cobblestone', 4)]));
    // The art lands after the capture is in flight.
    await Promise.resolve();
    expect(art.asked.some((u) => u.includes('path-cobblestone')), 'asked for the tile of the material on the map').toBe(true);
    deliver();

    const drawn = await shot;
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every(textured), 'every band of the surface, feather included').toBe(true);
  });

  it('waits for EVERY material on the map, so a two-surface map is not photographed half-textured', async () => {
    const shot = captureRoadFills(mapWith([
      road('path-overgrown-dirt', 6), road('path-overgrown-dirt', 7),
      road('path-cobblestone', 10), road('path-cobblestone', 11),
    ]));
    await Promise.resolve();
    for (const id of ['path-overgrown-dirt', 'path-cobblestone']) {
      expect(art.asked.some((u) => u.includes(id)), id).toBe(true);
    }
    deliver();
    expect((await shot).every(textured), 'both surfaces wear their tile').toBe(true);
  });
});
