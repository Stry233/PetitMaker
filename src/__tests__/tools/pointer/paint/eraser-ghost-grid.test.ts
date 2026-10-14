/**
 * The eraser's ghost preview must render on the grid that matches what a click would actually
 * erase: terrain (mountain/river) lies on the terrain grid, tiles/roads on the object grid — the
 * grid the paint brushes name to ToolOverlay.showGhost too (drawing-tool.ts). A tile-mode erase
 * ghost on the terrain grid would sit half a tile off from the cell the click would erase.
 */
import { describe, it, expect, vi } from 'vitest';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const m = (x: number, y: number): MacroCoord => ({ x, y });

describe('EraserTool: ghost grid alignment', () => {
  it('draws the ghost on the object grid while erasing tiles', () => {
    const state = makeState(10, 10);
    const executor = makeExecutor(state);
    const showGhost = vi.fn();
    const ctx = {
      ...makeToolCtx(state, executor, 1, 1, { contentType: 'road' }),
      overlay: { showGhost, clearGhost: vi.fn(), flashCommit: vi.fn() },
    } as any;

    new EraserTool().onPointerMove(cell(m(5, 5)), point(m(5, 5)), ctx);

    expect(showGhost).toHaveBeenCalledTimes(1);
    expect(showGhost.mock.calls[0]![0].grid).toBe('object');
  });

  it('draws the ghost on the terrain grid while erasing mountain/river', () => {
    const state = makeState(10, 10);
    const executor = makeExecutor(state);
    const showGhost = vi.fn();
    const ctx = { ...makeToolCtx(state, executor), overlay: { showGhost, clearGhost: vi.fn(), flashCommit: vi.fn() } } as any;

    new EraserTool().onPointerMove(cell(m(5, 5)), point(m(5, 5)), ctx);

    expect(showGhost).toHaveBeenCalledTimes(1);
    expect(showGhost.mock.calls[0]![0].grid).toBe('terrain');
  });

  it('the erase HIT TARGET (not just the ghost) is macro-cell-accurate in tile mode: same coords in, same cell erased', () => {
    // eraseTileCells/getCell both index the cells array by the plain (x,y) the pointer machine
    // resolves, so there is no separate hit test to get wrong — unlike the ghost's pixel offset above.
    const state = makeState(10, 10);
    // elevation 1 → the peel's elev-1 clears to null in one click (see terrain-peel.ts).
    state.cells[5]![5]!.terrain = { type: TerrainType.Mountain, elevation: 1, corners: ['square', 'square', 'square', 'square'] };
    const executor = makeExecutor(state);
    const eraser = new EraserTool();
    const ctx = makeToolCtx(state, executor);
    eraser.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
    eraser.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });
});
