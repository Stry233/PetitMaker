// @vitest-environment jsdom
/** The 2D chunk legend builds a few text rasters per frame, letters the rows and numbers the columns, and stops when its map is no longer current. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelLayer } from '../../../../view/map2d/layers/label-layer';
import { mapChunkAxes } from '../../../../core/grid/map-chunks';
import { makeState } from '../../../_support/map-state';

const pending: FrameRequestCallback[] = [];
beforeEach(() => {
  pending.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => { pending.length = 0; });
});
afterEach(() => { vi.unstubAllGlobals(); });

const texts = (layer: LabelLayer): string[] => layer.container.children.map((c) => (c as PIXI.Text).text);

describe('the 2D chunk legend', () => {
  it('builds every label over successive frames', () => {
    const template = makeState(100, 100).template;
    const { rows, columns } = mapChunkAxes(template);
    const render = vi.fn();
    const layer = new LabelLayer(render);
    layer.build(template, () => true);
    expect(texts(layer)).toHaveLength(2);
    while (pending.length) pending.shift()!(0);
    expect(texts(layer)).toHaveLength(rows.length + columns.length);
    expect(texts(layer).slice(0, 2)).toEqual(['A', 'B']);
    expect(texts(layer).at(-1)).toBe(String(columns.length));
    expect(render).toHaveBeenCalled();
  });

  it('stops a build whose map is no longer current', () => {
    const layer = new LabelLayer(() => {});
    let current = true;
    layer.build(makeState(100, 100).template, () => current);
    current = false;
    while (pending.length) pending.shift()!(0);
    expect(texts(layer)).toHaveLength(2);
  });
});
