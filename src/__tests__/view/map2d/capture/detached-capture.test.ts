// @vitest-environment jsdom
/**
 * A picture of a map no view shows carries its plan notes as the map's notes layer shows them: drawn
 * by the real annotation layer when shown, left out when the layer is hidden, and replaced or left
 * out when the caller names other notes or none.
 */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom loads no image, so an icon never decodes; the capture's drawing is what is under test.
vi.mock('../../../../view/map2d/draw/icon-texture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../view/map2d/draw/icon-texture')>()),
  decodeIcons: () => Promise.resolve([]),
}));
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import type { DetachedCaptureOptions } from '../../../../view/map2d/capture/detached-capture';
import type { GridState } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { sampleNotes } from '../../../_support/picture-renderer';
import { mapPictureFrame } from '../../../../view/map2d/capture/thumbnail';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { MAP_LIST } from '../../../../config/maps';
import { createGridState } from '../../../../core/model/template';
import { isLaidLandmark } from '../../../../core/model/landmarks';
import { objectRect } from '../../../../state/object-geometry';

let renderer: MapRenderer | null = null;
afterEach(() => { renderer?.destroy(); renderer = null; });

/** The drawn parts of the notes layer in the world the capture rasterizes; null for no layer. */
async function notesDrawn(state: GridState, options?: DetachedCaptureOptions): Promise<number | null> {
  renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
  let drawn: number | null = null;
  const raster = renderer.app.renderer as unknown as Record<string, unknown>;
  raster.generateTexture = (world: PIXI.Container) => {
    // Base, terrain and objects come first; a fourth child is the notes layer.
    const notes = world.children[3] as PIXI.Container | undefined;
    drawn = notes ? notes.children.reduce((n, pass) => n + ((pass as PIXI.Container).children?.length ?? 0), 0) : null;
    return { destroy: () => {} };
  };
  raster.extract = { canvas: () => document.createElement('canvas') };
  await renderer.captureState(state, options);
  renderer.destroy();
  renderer = null;
  return drawn;
}

describe('the notes in a detached capture', () => {
  it('draws the map\'s own notes, every kind of them', async () => {
    const state = makeState(12, 12);
    state.annotations = sampleNotes();
    expect(await notesDrawn(state)).toBeGreaterThanOrEqual(4);
  });

  it('leaves them out where the map hides its notes layer, or holds none', async () => {
    const hidden = makeState(12, 12);
    hidden.annotations = sampleNotes(false);
    expect(await notesDrawn(hidden)).toBeNull();
    expect(await notesDrawn(makeState(12, 12))).toBeNull();
  });

  it('draws the notes it is given in place of the map\'s, and none when told so', async () => {
    const bare = makeState(12, 12);
    expect(await notesDrawn(bare, { notes: sampleNotes() })).toBeGreaterThanOrEqual(4);
    const noted = makeState(12, 12);
    noted.annotations = sampleNotes();
    expect(await notesDrawn(noted, { notes: null })).toBeNull();
  });
});

/** The region the capture rasterizes, and the shapes its Graphics hold, read before it destroys them. */
async function captured(state: GridState, options?: DetachedCaptureOptions): Promise<{ region: number[]; shapes: number; objects: number[] }> {
  renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
  let shot: { region: number[]; shapes: number; objects: number[] } | null = null;
  const raster = renderer.app.renderer as unknown as Record<string, unknown>;
  raster.generateTexture = (world: PIXI.Container, opts: { region: PIXI.Rectangle }) => {
    const { x, y, width, height } = opts.region;
    const shapes = world.children
      .filter((c): c is PIXI.Graphics => c instanceof PIXI.Graphics)
      .reduce((n, g) => n + g.geometry.graphicsData.length, 0);
    // Base, terrain, then the object layer: the bounds of everything it drew.
    const b = (world.children[2] as PIXI.Container).getLocalBounds();
    shot = { region: [x, y, width, height], shapes, objects: [b.x, b.y, b.width, b.height] };
    return { destroy: () => {} };
  };
  raster.extract = { canvas: () => document.createElement('canvas') };
  await renderer.captureState(state, options);
  renderer.destroy();
  renderer = null;
  return shot!;
}

describe('the frame and flags of a detached capture', () => {
  it('is taken over the frame a painter places the picture by', async () => {
    const state = makeState(12, 10);
    const frame = mapPictureFrame(state);
    expect((await captured(state)).region).toEqual([frame.x, frame.y, frame.width, frame.height].map((v) => v * TILE_SIZE));
  });

  it('holds everything each built-in planet draws, a landmark laid past the template\'s edge included', async () => {
    for (const template of MAP_LIST) {
      const state = createGridState(template);
      const frame = mapPictureFrame(state);
      const shot = await captured(state);
      expect(shot.region, template.id).toEqual([frame.x, frame.y, frame.width, frame.height].map((v) => v * TILE_SIZE));
      const [rx, ry, rw, rh] = shot.region as [number, number, number, number];
      const inside = (x: number, y: number, w: number, h: number) => x >= rx - 1e-6 && y >= ry - 1e-6 && x + w <= rx + rw + 1e-6 && y + h <= ry + rh + 1e-6;
      const landmarks = [...state.objects.values()].filter(isLaidLandmark);
      expect(landmarks.length, template.id).toBeGreaterThan(0);
      for (const l of landmarks) {
        const r = objectRect(l);
        expect(inside(r.x * TILE_SIZE, r.y * TILE_SIZE, r.w * TILE_SIZE, r.h * TILE_SIZE), `${template.id} ${l.id}`).toBe(true);
      }
      const [ox, oy, ow, oh] = shot.objects as [number, number, number, number];
      if (ow > 0 && oh > 0) expect(inside(ox, oy, ow, oh), `${template.id} drawn objects`).toBe(true);
    }
  });

  it('draws flagged objects as the live overlay flags them: a wash and an edge per footprint', async () => {
    const state = makeState(12, 12);
    const flagged = [
      { id: 'a', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0 as const, elevation: 0 },
      { id: 'b', catalogId: 'tree-apple', position: { x: 6, y: 6 }, rotation: 0 as const, elevation: 0 },
    ];
    const plain = await captured(state);
    expect((await captured(state, { flagged })).shapes - plain.shapes).toBe(2 * flagged.length);
  });
});
