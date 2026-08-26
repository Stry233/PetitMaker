/**
 * A captured map has its roads on it — the candidate cards and the restore offer are photographs of
 * a map nobody is looking at, taken in ONE synchronous pass with no next frame.
 *
 * Two things a live view gets for free and a capture cannot. A road surface is drawn on a queued
 * frame (`scheduleRoadRefresh`), which for a capture never comes: the world is rasterized and thrown
 * away first, so the picture had no roads on it at all. And a path material's tile art is cropped
 * from its icon asynchronously, so a surface drawn before it lands fills with the material's colour
 * instead of the art the map itself shows.
 */
import './_pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GridState, PlacedObject, EditorEvents } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { EventBus } from '../../core/commands/event-bus';

// jsdom decodes no image, so the real crop can never land. Stand in for it: the art arrives only
// when `deliver` is called, which is what `roadTileReady` must be waiting for.
const art = vi.hoisted(() => {
  const state = {
    canvas: null as HTMLCanvasElement | null,
    waiting: [] as Array<() => void>,
    asked: [] as string[],
  };
  return state;
});
vi.mock('../../canvas/road-tile-texture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../canvas/road-tile-texture')>();
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

/** The tile art, once it has "loaded", handed to everyone waiting on it. */
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
 * Take the picture, handing back the fill textures of the ROAD SURFACES as they stood at the
 * instant the world was rasterized. jsdom has no GL, so the rasterization itself is stubbed — what
 * the capture handed it is the whole question here, and it has to be read THEN: the capture destroys
 * its world on the way out, so an inspection afterwards finds an empty container either way.
 *
 * `Texture.WHITE` is what a plain `beginFill(colour)` records, so it reads as "no art here".
 */
async function captureRoadFills(state: GridState): Promise<PIXI.Texture[]> {
  const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
  const gl = (renderer as unknown as { app: { renderer: Record<string, unknown> } }).app.renderer;
  let fills: PIXI.Texture[] | null = null;
  gl.generateTexture = (world: PIXI.Container) => {
    // The road surfaces are the object layer's own Graphics — one per surface, at index 0 of its
    // elevation container. Every other Graphics on the map hangs off base/terrain, which are this
    // world's other two children.
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
    // The art is already in hand, so what is at stake here is only whether the surfaces were drawn.
    deliver();
    const drawn = await captureRoadFills(mapWith([road('path-overgrown-dirt', 3), road('path-overgrown-dirt', 4)]));
    expect(drawn.length, 'a road surface was drawn').toBeGreaterThan(0);
  });

  it('waits for each path material\'s tile art, so a road is photographed in its art', async () => {
    const shot = captureRoadFills(mapWith([road('path-cobblestone', 3), road('path-cobblestone', 4)]));
    // The capture is held on the art: it lands only now, after the call is already in flight.
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
