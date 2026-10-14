import { describe, expect, it } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import type { BuildShape } from '../../../../state/editing/edit-mode';
import { makeExecutor, makeState } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const AT = { x: 0, y: 0 };

function world(mode: BuildShape) {
  const state = makeState(30, 30);
  const executor = makeExecutor(state);
  const ctx = makeToolCtx(state, executor);
  const tool = new DrawingTool();
  arm(ctx, { shape: mode, contentType: 'mountain' });
  tool.onActivate(ctx);
  const before = JSON.stringify(state.cells);
  const down = (c: MacroCoord) => tool.onPointerDown(cell(c), point(AT), ctx);
  const move = (c: MacroCoord) => tool.onPointerMove(cell(c), point(AT), ctx);
  const up = (c: MacroCoord) => tool.onPointerUp(cell(c), point(AT), ctx);
  return { state, executor, ctx, tool, down, move, up, unchanged: () => JSON.stringify(state.cells) === before };
}

const mountains = (state: ReturnType<typeof makeState>) =>
  state.cells.flat().filter((c) => c?.terrain?.type === TerrainType.Mountain).length;

describe('cancelling a terrain brush press', () => {
  it('takes back a freehand stroke already on the map, with nothing to redo', () => {
    const w = world('free');
    w.down({ x: 5, y: 5 });
    for (let x = 6; x < 12; x++) w.move({ x, y: 5 });
    expect(mountains(w.state)).toBeGreaterThan(0);
    w.tool.onPointerCancel(w.ctx);
    expect(w.unchanged()).toBe(true);
    expect(w.executor.canUndo()).toBe(false);
    expect(w.executor.canRedo()).toBe(false);
  });

  it('keeps the strokes before the cancelled one', () => {
    const w = world('free');
    w.down({ x: 2, y: 2 }); w.up({ x: 2, y: 2 });
    const kept = JSON.stringify(w.state.cells);
    w.down({ x: 8, y: 8 }); w.move({ x: 9, y: 8 });
    w.tool.onPointerCancel(w.ctx);
    expect(JSON.stringify(w.state.cells)).toBe(kept);
    expect(w.executor.historyDepth()).toBe(1);
  });

  it.each(['line', 'rect', 'circle'] as const)('lays nothing for a cancelled %s, and the next release starts afresh', (mode) => {
    const w = world(mode);
    w.down({ x: 3, y: 3 });
    w.move({ x: 9, y: 7 });
    w.tool.onPointerCancel(w.ctx);
    expect(w.unchanged()).toBe(true);
    // A release after the cancel belongs to no press and lays nothing.
    w.up({ x: 9, y: 7 });
    expect(w.unchanged()).toBe(true);
    w.down({ x: 3, y: 3 }); w.up({ x: 9, y: 7 });
    expect(mountains(w.state)).toBeGreaterThan(0);
    expect(w.executor.historyDepth()).toBe(1);
  });

  it('drops only the anchor the cancelled press added to a curve', () => {
    const w = world('curve');
    const click = (c: MacroCoord) => { w.down(c); w.up(c); };
    click({ x: 2, y: 2 });
    click({ x: 8, y: 9 });
    w.down({ x: 15, y: 3 });
    w.tool.onPointerCancel(w.ctx);
    // Finishing on the last surviving anchor paints through the two kept ones only.
    click({ x: 8, y: 9 });
    expect(w.state.cells[2]![2]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(w.state.cells[9]![8]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(w.state.cells[3]![15]!.terrain).toBeNull();
  });

  it('Escape drops a curve in progress without touching history', () => {
    const w = world('curve');
    for (const c of [{ x: 2, y: 2 }, { x: 8, y: 9 }]) { w.down(c); w.up(c); }
    expect(w.tool.cancelPending(w.ctx)).toBe(true);
    expect(w.unchanged()).toBe(true);
    expect(w.executor.canUndo()).toBe(false);
    expect(w.tool.cancelPending(w.ctx)).toBe(false);
  });
});
