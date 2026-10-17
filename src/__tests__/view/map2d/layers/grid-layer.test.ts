// @vitest-environment jsdom
/** The 2D reference grid redraws its screen-sized strokes only when the scale they were drawn at changes, draws whole on the placement grid for a capture and puts the editor's choices back after, and glides its cell lines between grids. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridId } from '../../../../core/grid/grids';
import { __resetMotionState, setReducedMotion } from '../../../../platform/channels/motion-state';
import { animConfig } from '../../../../view/shared/motion/anim-config';
import { GridLayer } from '../../../../view/map2d/layers/grid-layer';
import { CellGrid } from '../../../../view/map2d/draw/cell-grid';
import { makeState } from '../../../_support/map-state';

function layer(shown: GridId | null, showChunks: boolean) {
  const grid = new GridLayer();
  grid.setMap(makeState(40, 40).template, shown, showChunks);
  const [cells, chunks] = grid.container.children as [CellGrid, PIXI.Graphics];
  return { grid, cells, chunks, drawn: vi.spyOn(cells, 'draw') };
}

const filled = (g: PIXI.Graphics): boolean => g.geometry.graphicsData.length > 0;
const OBJECT = { x: 0, y: 0 };
const TERRAIN = { x: -0.5, y: -0.5 };

afterEach(() => { vi.useRealTimers(); __resetMotionState(); });

describe('the 2D grid layer', () => {
  it('stacks the chunk bounds over the cell lines', () => {
    const { cells, chunks } = layer('object', true);
    expect(cells).toBeInstanceOf(CellGrid);
    expect(chunks).toBeInstanceOf(PIXI.Graphics);
  });

  it('follows the zoom only when a shown stroke was drawn at another scale', () => {
    const { grid, drawn } = layer('object', false);
    grid.follow(1);
    grid.follow(1);
    expect(drawn).toHaveBeenCalledTimes(1);
    grid.follow(2);
    expect(drawn).toHaveBeenCalledTimes(2);
  });

  it('leaves hidden strokes alone while following', () => {
    const { grid, drawn, chunks } = layer(null, false);
    grid.follow(1.5);
    expect(drawn).not.toHaveBeenCalled();
    expect(filled(chunks)).toBe(false);
  });

  it('draws everything for a capture and restores the toggles on redraw', () => {
    const { grid, drawn, chunks } = layer(null, false);
    grid.drawForCapture(0.5);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 0.5, true, OBJECT);
    expect(filled(chunks)).toBe(true);
    grid.redraw(1);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), false, 1, false, OBJECT);
    expect(filled(chunks)).toBe(false);
  });

  it('applies new toggles at the given scale', () => {
    const { grid, drawn, chunks } = layer(null, false);
    grid.setVisibility('terrain', true, 2);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 2, true, TERRAIN);
    expect(filled(chunks)).toBe(true);
  });

  it('draws a capture on the placement grid while the terrain grid shows, then puts the terrain grid back', () => {
    const { grid, drawn } = layer('terrain', false);
    grid.drawForCapture(0.5);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 0.5, true, OBJECT);
    grid.redraw(1);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 1, false, TERRAIN);
  });

  it('glides a shown grid to another grid over the registry motion, frame by frame', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { grid, drawn } = layer('object', false);
    grid.setVisibility('terrain', false, 1);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 1, false, OBJECT);
    vi.advanceTimersByTime(animConfig.gridShift.durationMs / 2);
    expect(grid.step(1)).toBe(true);
    const mid = drawn.mock.lastCall![4];
    expect(mid.x).toBeLessThan(0);
    expect(mid.x).toBeGreaterThan(-0.5);
    expect(mid.y).toBe(mid.x);
    vi.advanceTimersByTime(animConfig.gridShift.durationMs);
    expect(grid.step(1)).toBe(true);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 1, false, TERRAIN);
    expect(grid.step(1)).toBe(false);
  });

  it('lands on the new grid at once under reduced motion', () => {
    setReducedMotion(true);
    const { grid, drawn } = layer('object', false);
    grid.setVisibility('terrain', false, 1);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 1, false, TERRAIN);
    expect(grid.step(1)).toBe(false);
  });

  it('shows a grid coming into view on its own grid at once', () => {
    const { grid, drawn } = layer(null, false);
    grid.setVisibility('terrain', false, 1);
    expect(drawn).toHaveBeenLastCalledWith(expect.anything(), true, 1, false, TERRAIN);
    expect(grid.step(1)).toBe(false);
  });
});
