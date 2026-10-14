// @vitest-environment jsdom
/**
 * The zone colours draw as one Graphics per chunk over a single sea backdrop, and a cells change
 * repaints only the chunks whose zones it actually changed, once per frame.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { BaseLayer } from '../../../../view/map2d/layers/base-layer';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { rendererLayers } from '../../../_support/renderer-layers';
import { EventBus } from '../../../../core/commands/event-bus';
import { TerrainType } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import type { GridState } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState, setTerrain, setZone } from '../../../_support/map-state';
import { cellSet } from '../../../../core/grid/grids';
import { TERRAIN_GRID } from '../../../../core/game/profile';

const graphics = (layer: BaseLayer): PIXI.Graphics[] =>
  layer.container.children.filter((c): c is PIXI.Graphics => c instanceof PIXI.Graphics);

describe('BaseLayer chunks', () => {
  it('draws a backdrop and one Graphics per chunk', () => {
    const state = makeState(40, 20) as GridState;
    const layer = new BaseLayer(() => {});
    layer.drawFull(state);
    expect(graphics(layer)).toHaveLength(1 + 3 * 2);
  });

  it('repaints on flush only the chunks whose zones changed', () => {
    const state = makeState(40, 40) as GridState;
    const layer = new BaseLayer(() => {});
    layer.drawFull(state);
    setZone(state, 2, 2, CellZone.Void);
    setZone(state, 20, 2, CellZone.Beach);
    setTerrain(state, 2, 20, TerrainType.Mountain, 1);
    layer.redrawCells([{ x: 2, y: 2 }, { x: 20, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 20 }], state);
    expect(layer.flushDirty(state), 'two chunks changed zone; a terrain-only edit is not the base layer\'s').toBe(2);
    expect(layer.flushDirty(state), 'clean after the flush').toBe(0);
    layer.redrawCells([{ x: 2, y: 2 }], state);
    expect(layer.flushDirty(state), 'an unchanged zone repaints nothing').toBe(0);
  });

  it('a repainted chunk draws its new zone runs', () => {
    const state = makeState(16, 16) as GridState;
    const layer = new BaseLayer(() => {});
    layer.drawFull(state);
    const chunk = graphics(layer)[1]!;
    const before = chunk.geometry.graphicsData.length;
    setZone(state, 5, 5, CellZone.Beach);
    layer.redrawCells([{ x: 5, y: 5 }], state);
    layer.flushDirty(state);
    expect(chunk.geometry.graphicsData.length, 'one grass run split around the sand cell').toBe(before + 2);
  });
});

describe('MapRenderer base refresh', () => {
  const renderers: MapRenderer[] = [];
  afterEach(() => { for (const r of renderers.splice(0)) r.destroy(); });

  it('repaints the base layer for a zone change before the next frame', () => {
    const bus = new EventBus<EditorEvents>();
    const r = new MapRenderer(bus, document.createElement('div'), 200, 200);
    renderers.push(r);
    const state = makeState(32, 32) as GridState;
    r.initMap(state, false);
    const flush = vi.spyOn(rendererLayers(r).baseLayer, 'flushDirty');
    vi.spyOn(r.app.renderer, 'render').mockImplementation(() => {});
    setZone(state, 20, 20, CellZone.Void);
    bus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, [{ x: 20, y: 20 }])] });
    r.onNextPaint(() => {});
    (r as unknown as { renderTick: () => void }).renderTick();
    expect(flush).toHaveReturnedWith(1);
  });
});
