// @vitest-environment jsdom
/** Captures control reference grids independently of annotations and omit transient tool feedback. */
import '../../../_support/pixi-env';
import { describe, it, expect, afterEach } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { rendererLayers } from '../../../_support/renderer-layers';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState } from '../../../_support/map-state';
import { cellSet } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';

const renderers: MapRenderer[] = [];
afterEach(() => { for (const r of renderers.splice(0)) r.destroy(); });

interface Bake { overlayVisible: boolean; regionVisible: boolean; gridVisible: boolean; annotationsVisible: boolean }

/** Capture once, reading the overlay's visibility flags at the instant the world is rasterized. */
function captureReading(includeGrid: boolean, prepare: (r: MapRenderer) => void): { bake: Bake | null; renderer: MapRenderer } {
  const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
  renderers.push(renderer);
  renderer.initMap(makeState(20, 20), null, false);
  prepare(renderer);
  const overlay = {
    container: rendererLayers(renderer).overlayLayer.container,
    buildableGraphics: overlayPart<PIXI.Graphics>(rendererLayers(renderer).overlayLayer, 'buildableGraphics'),
    grid: rendererLayers(renderer).gridLayer.container,
  };
  const gl = (renderer as unknown as { app: { renderer: Record<string, unknown> } }).app.renderer;
  let bake: Bake | null = null;
  gl.generateTexture = () => {
    bake = {
      overlayVisible: overlay.container.worldVisible, regionVisible: overlay.buildableGraphics.worldVisible,
      gridVisible: overlay.grid.worldVisible, annotationsVisible: rendererLayers(renderer).annotationLayer.container.worldVisible,
    };
    return { destroy: () => {} };
  };
  gl.extract = { canvas: () => document.createElement('canvas') };
  renderer.capture({ maxPx: 256, grid: includeGrid });
  return { bake, renderer };
}

describe('the map capture and the overlay layer', () => {
  it('bakes visible grid lines while omitting tool feedback', () => {
    const { bake } = captureReading(true, (r) => rendererLayers(r).overlayLayer.showBuildableRegion(cellSet('terrain', [{ x: 2, y: 2 }, { x: 3, y: 2 }])));
    expect(bake).not.toBeNull();
    expect(bake!.overlayVisible).toBe(false);
    expect(bake!.gridVisible).toBe(true);
    expect(bake!.regionVisible).toBe(false);
  });

  it('puts the feedback back as it stood, hidden children included', () => {
    const { renderer } = captureReading(true, (r) => {
      rendererLayers(r).overlayLayer.showBuildableRegion(cellSet('terrain', [{ x: 2, y: 2 }]));
      overlayPart<PIXI.Sprite>(rendererLayers(r).overlayLayer, 'previewIcon').visible = false;
    });
    const part = <T,>(field: string) => overlayPart<T>(rendererLayers(renderer).overlayLayer, field);
    expect(part<PIXI.Graphics>('buildableGraphics').visible).toBe(true);
    expect(part<PIXI.Sprite>('previewIcon').visible).toBe(false);
    expect(rendererLayers(renderer).gridLayer.container.visible).toBe(true);
  });

  it('hides the grid and tool feedback while retaining annotations for a capture without grids', () => {
    const { bake } = captureReading(false, (r) => rendererLayers(r).overlayLayer.showBuildableRegion(cellSet('terrain', [{ x: 2, y: 2 }])));
    expect(bake!.overlayVisible).toBe(false);
    expect(bake!.gridVisible).toBe(false);
    expect(bake!.annotationsVisible).toBe(true);
  });
});
