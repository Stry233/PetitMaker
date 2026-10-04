/** Captures control reference grids independently of annotations and omit transient tool feedback. */
import './_pixi-env';
import { describe, it, expect, afterEach } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

const renderers: MapRenderer[] = [];
afterEach(() => { for (const r of renderers.splice(0)) r.destroy(); });

interface Bake { overlayVisible: boolean; regionVisible: boolean; gridVisible: boolean; annotationsVisible: boolean }

/** Capture once, reading the overlay's visibility flags at the instant the world is rasterized. */
function captureReading(includeGrid: boolean, prepare: (r: MapRenderer) => void): { bake: Bake | null; renderer: MapRenderer } {
  const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
  renderers.push(renderer);
  renderer.initMap(makeState(20, 20), false, false);
  prepare(renderer);
  const overlay = renderer.overlayLayer as unknown as { container: PIXI.Container; buildableGraphics: PIXI.Graphics; gridGraphics: PIXI.Graphics };
  const gl = (renderer as unknown as { app: { renderer: Record<string, unknown> } }).app.renderer;
  let bake: Bake | null = null;
  gl.generateTexture = () => {
    bake = {
      overlayVisible: overlay.container.worldVisible, regionVisible: overlay.buildableGraphics.worldVisible,
      gridVisible: overlay.gridGraphics.worldVisible, annotationsVisible: renderer.annotationLayer.container.worldVisible,
    };
    return { destroy: () => {} };
  };
  gl.extract = { canvas: () => document.createElement('canvas') };
  renderer.captureMapCanvas(256, includeGrid);
  return { bake, renderer };
}

describe('captureMapCanvas and the overlay layer', () => {
  it('bakes visible grid lines while omitting tool feedback', () => {
    const { bake } = captureReading(true, (r) => r.overlayLayer.showBuildableRegion([{ x: 2, y: 2 }, { x: 3, y: 2 }], true));
    expect(bake).not.toBeNull();
    expect(bake!.overlayVisible).toBe(false);
    expect(bake!.gridVisible).toBe(true);
    expect(bake!.regionVisible).toBe(false);
  });

  it('puts the feedback back as it stood, hidden children included', () => {
    const { renderer } = captureReading(true, (r) => {
      r.overlayLayer.showBuildableRegion([{ x: 2, y: 2 }], true);
      (r.overlayLayer as unknown as { previewIcon: PIXI.Sprite }).previewIcon.visible = false;
    });
    const overlay = renderer.overlayLayer as unknown as { buildableGraphics: PIXI.Graphics; previewIcon: PIXI.Sprite; gridGraphics: PIXI.Graphics };
    expect(overlay.buildableGraphics.visible).toBe(true);
    expect(overlay.previewIcon.visible).toBe(false);
    expect(overlay.gridGraphics.visible).toBe(true);
  });

  it('hides the grid and tool feedback while retaining annotations for a capture without grids', () => {
    const { bake } = captureReading(false, (r) => r.overlayLayer.showBuildableRegion([{ x: 2, y: 2 }], true));
    expect(bake!.overlayVisible).toBe(false);
    expect(bake!.gridVisible).toBe(false);
    expect(bake!.annotationsVisible).toBe(true);
  });
});
