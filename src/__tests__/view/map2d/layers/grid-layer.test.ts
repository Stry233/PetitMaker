// @vitest-environment jsdom
/** The 2D reference grid redraws its screen-sized strokes only when the scale they were drawn at changes, draws whole for a capture and puts the editor's toggles back after. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { describe, expect, it, vi } from 'vitest';
import { GridLayer } from '../../../../view/map2d/layers/grid-layer';
import { CellGrid } from '../../../../view/map2d/draw/cell-grid';
import { makeState } from '../../../_support/map-state';

function layer(showCells: boolean, showChunks: boolean) {
  const grid = new GridLayer();
  grid.setMap(makeState(40, 40).template, showCells, showChunks);
  const [cells, chunks] = grid.container.children as [CellGrid, PIXI.Graphics];
  return { grid, cells, chunks, drawn: vi.spyOn(cells, 'draw') };
}

const filled = (g: PIXI.Graphics): boolean => g.geometry.graphicsData.length > 0;

describe('the 2D grid layer', () => {
  it('stacks the chunk bounds over the cell lines', () => {
    const { cells, chunks } = layer(true, true);
    expect(cells).toBeInstanceOf(CellGrid);
    expect(chunks).toBeInstanceOf(PIXI.Graphics);
  });

  it('follows the zoom only when a shown stroke was drawn at another scale', () => {
    const { grid, drawn } = layer(true, false);
    grid.follow(1);
    grid.follow(1);
    expect(drawn).toHaveBeenCalledTimes(1);
    grid.follow(2);
    expect(drawn).toHaveBeenCalledTimes(2);
  });

  it('leaves hidden strokes alone while following', () => {
    const { grid, drawn, chunks } = layer(false, false);
    grid.follow(1.5);
    expect(drawn).not.toHaveBeenCalled();
    expect(filled(chunks)).toBe(false);
  });

  it('draws everything for a capture and restores the toggles on redraw', () => {
    const { grid, drawn, chunks } = layer(false, false);
    grid.drawForCapture(0.5);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 0.5, true);
    expect(filled(chunks)).toBe(true);
    grid.redraw(1);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), false, 1, false);
    expect(filled(chunks)).toBe(false);
  });

  it('applies new toggles at the given scale', () => {
    const { grid, drawn, chunks } = layer(false, false);
    grid.setVisibility(true, true, 2);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 2, true);
    expect(filled(chunks)).toBe(true);
  });
});
