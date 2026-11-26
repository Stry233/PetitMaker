import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import type { MacroCoord } from '../../../../core/model/types';
import { line4 } from '../../../../core/grid/shapes';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const exec = (state: any) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });
const elevAt = (state: any, x: number, y: number) => state.cells[y]?.[x]?.terrain?.elevation ?? 0;

describe('DrawingTool: fast-drag continuity', () => {
  it('[EDIT-04] a single far move paints every cell on the 4-connected path (no gaps)', () => {
    const state = makeState(12, 12);
    const ex = exec(state);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1);
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(2, 2)), point(m(2, 2)), ctx);  // start
    tool.onPointerMove(cell(m(7, 5)), point(m(7, 5)), ctx);  // One fast jump (+5, +3): no intermediate samples
    tool.onPointerUp(cell(m(7, 5)), point(m(7, 5)), ctx);
    // every cell along the interpolated 4-connected path is painted, not only the endpoints
    for (const p of line4(2, 2, 7, 5)) expect(elevAt(state, p.x, p.y), `(${p.x},${p.y}) painted`).toBe(1);
  });
});

// Atomic undo: with auto-trim on, the trim/fill commands fold into the
// last block entry of the stroke: undo steps are block creations only.
describe('DrawingTool: auto-trim undo folding (ATOMIC UNDO)', () => {
  it('[EDIT-19] a click with auto-trim on undoes in ONE step (block + its trims together)', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1, { autoEdgeCut: 'round' });
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
    tool.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);

    expect(state.cells[5]![5]!.terrain?.corners, 'isolated cell got rounded').toEqual(['fan', 'fan', 'fan', 'fan']);
    expect(ex.historyDepth(), 'paint + trims = one history entry').toBe(1);
    ex.undo();
    expect(state.cells[5]![5]!.terrain ?? null, 'one undo removes the block (and its trims)').toBeNull();
  });
});
