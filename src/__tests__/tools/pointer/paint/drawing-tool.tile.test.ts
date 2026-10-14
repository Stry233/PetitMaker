import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { type MacroCoord } from '../../../../core/model/types';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, objectsByCatalog, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const exec = (state: any) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });

describe('DrawingTool: tile surface', () => {
  it('brush places a single tile (size 1)', () => {
    const state = makeState(10, 10);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, exec(state));
    arm(ctx, { contentType: 'road', shape: 'free' });
    tool.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
    tool.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);
    const t = objectsByCatalog(state, 'path-overgrown-dirt');
    expect(t.length).toBe(1);
    expect(t[0]!.position).toEqual({ x: 5, y: 5 });
  });

  it('rect fills its footprint with tiles', () => {
    const state = makeState(10, 10);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, exec(state));
    arm(ctx, { contentType: 'road', shape: 'rect' });
    tool.onPointerDown(cell(m(2, 2)), point(m(2, 2)), ctx);
    tool.onPointerUp(cell(m(4, 4)), point(m(4, 4)), ctx);
    expect(objectsByCatalog(state, 'path-overgrown-dirt').length).toBe(9); // 3x3
  });

  it('does not paint terrain in tile mode', () => {
    const state = makeState(10, 10);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, exec(state));
    arm(ctx, { contentType: 'road', shape: 'free' });
    tool.onPointerDown(cell(m(7, 7)), point(m(7, 7)), ctx);
    tool.onPointerUp(cell(m(7, 7)), point(m(7, 7)), ctx);
    expect(state.cells[7]![7]!.terrain).toBeNull();
  });
});
