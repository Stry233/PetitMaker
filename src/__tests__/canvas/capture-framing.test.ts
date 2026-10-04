import './_pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { describe, expect, it } from 'vitest';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { EventBus } from '../../core/commands/event-bus';
import { TILE_SIZE } from '../../core/model/constants';
import type { EditorEvents } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

describe('thumbnail capture framing', () => {
  it('fills the thumbnail with the saved island rectangle while preserving explicit region crops', async () => {
    const state = makeState(20, 12);
    state.template = { ...state.template, chunkGrid: { origin: { x: -16, y: -16 }, columns: 4, rows: 3 } };
    const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
    const regions: PIXI.Rectangle[] = [];
    const raster = renderer.app.renderer as unknown as Record<string, unknown>;
    raster.generateTexture = (_world: PIXI.Container, options: { region: PIXI.Rectangle }) => {
      regions.push(options.region.clone());
      return { destroy: () => {} };
    };
    raster.extract = { canvas: () => document.createElement('canvas') };
    try {
      await renderer.captureState(state);
      await renderer.captureState(state, 640, { x: 2, y: 3, width: 4, height: 5 });
      expect(regions.map((r) => [r.x, r.y, r.width, r.height].map((v) => v / TILE_SIZE))).toEqual([
        [-0.5, -0.5, 20.5, 12.5],
        [1.5, 2.5, 4, 5],
      ]);
    } finally {
      renderer.destroy();
    }
  });
});

it('fits the default 2D view to the saved island', () => {
  const state = makeState(169, 140);
  state.template = { ...state.template, chunkGrid: { origin: { x: -15, y: -23 }, columns: 13, rows: 12 } };
  const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 1040, 960);
  try {
    renderer.initMap(state, false, false);
    expect(renderer.viewport.getZoom()).toBeCloseTo(1040 / (169 * TILE_SIZE));
    expect(renderer.viewport.worldAtCentre()).toEqual({ x: 84.5 * TILE_SIZE, y: 70 * TILE_SIZE });
  } finally {
    renderer.destroy();
  }
});
