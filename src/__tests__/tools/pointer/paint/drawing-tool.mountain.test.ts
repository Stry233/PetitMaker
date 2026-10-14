import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { line4 } from '../../../../core/grid/shapes';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const exec = (state: any) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });
const elevAt = (state: any, x: number, y: number) => state.cells[y]?.[x]?.terrain?.elevation ?? 0;

// A mountain brush builds each cell up to the selected layer (ctx.arming.floor),
// auto-filling the support column. The post-stroke 3x3 rule (V-MTN-03) caps an
// unsupported N>=4 result at the highest valid layer and warns.
describe('DrawingTool: mountain builds to the selected layer', () => {
  function brushAt(state: any, ex: CommandExecutor, at: { x: number; y: number }, layer: number, brushSize = 1) {
    const { x, y } = at;
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, brushSize, layer);
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(x, y)), point(m(x, y)), ctx);
    tool.onPointerUp(cell(m(x, y)), point(m(x, y)), ctx);
  }

  it('builds a cell up to the selected layer, auto-filling the column below', () => {
    const state = makeState(10, 10);
    brushAt(state, exec(state), { x: 5, y: 5 }, 2); // select layer 2
    // The cell becomes a solid column of height 2 (occupies layers 1..2).
    expect(state.cells[5]![5]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(elevAt(state, 5, 5)).toBe(2);
  });

  it('caps an unsupported N>=4 pillar at the highest valid layer (warns)', () => {
    const state = makeState(10, 10);
    brushAt(state, exec(state), { x: 5, y: 5 }, 4); // select layer 4, no 3x3 base
    // V-MTN-03 reverts only the illegal top — a lone pillar settles at layer 3.
    expect(elevAt(state, 5, 5)).toBe(3);
  });

  it('builds to N=4 when a 3x3 base supports it', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 1, 3); // 3x3 platform at layer 1
    brushAt(state, ex, { x: 5, y: 5 }, 4);    // raise the center to layer 4
    expect(elevAt(state, 5, 5)).toBe(4);   // center reaches 4 on its 3x3 base
    expect(elevAt(state, 4, 4)).toBe(1);   // a corner of the platform stays at 1
  });

  it('never lowers — a lower floor over taller terrain stacks, never drops', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 3);  // lone column to layer 3
    brushAt(state, ex, { x: 5, y: 5 }, 1);  // floor 1 over a layer-3 cell → tries 4, 3x3-capped to 3
    expect(elevAt(state, 5, 5)).toBe(3); // not lowered to 1
  });
});

// Painting over an existing mountain stacks it one layer higher and the panel
// highlight follows; fresh ground drops back to the selected floor.
describe('DrawingTool: mountain auto-stacking', () => {
  function brushAt(state: any, ex: CommandExecutor, at: { x: number; y: number }, layer: number) {
    const { x, y } = at;
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1, layer);
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(x, y)), point(m(x, y)), ctx);
    tool.onPointerUp(cell(m(x, y)), point(m(x, y)), ctx);
  }

  it('stacks one layer higher when painting over a mountain at the floor', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 1); // fresh → layer 1
    brushAt(state, ex, { x: 5, y: 5 }, 1); // already at the floor → stacks to 2
    expect(elevAt(state, 5, 5)).toBe(2);
  });

  it('keeps climbing on repeated paints over the same spot', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 1); // 1
    brushAt(state, ex, { x: 5, y: 5 }, 1); // 2
    brushAt(state, ex, { x: 5, y: 5 }, 1); // 3
    expect(elevAt(state, 5, 5)).toBe(3);
  });

  it('drops back to the floor on fresh ground (jump back)', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 1);
    brushAt(state, ex, { x: 5, y: 5 }, 1); // (5,5) climbs to 2
    brushAt(state, ex, { x: 8, y: 8 }, 1); // fresh cell → back to the floor (1)
    expect(elevAt(state, 8, 8)).toBe(1);
  });

  it('panel highlight follows the stack and jumps back to the floor', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 1); // (5,5) now at layer 1

    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1, 1); // floor 1
    const seen: (number | null)[] = [];
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    ctx.setDisplayLayer = (n) => seen.push(n);

    tool.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx); // over the layer-1 cell → stacks to 2
    tool.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);
    expect(elevAt(state, 5, 5)).toBe(2);
    expect(seen[seen.length - 1]).toBe(2); // panel highlights layer 2

    seen.length = 0;
    tool.onPointerDown(cell(m(8, 8)), point(m(8, 8)), ctx); // fresh ground
    tool.onPointerUp(cell(m(8, 8)), point(m(8, 8)), ctx);
    expect(elevAt(state, 8, 8)).toBe(1);
    expect(seen[seen.length - 1]).toBe(1); // panel back to layer 1
  });

  it('does not jump on release: crossing a stack then ending on fresh ground stays on the floor', () => {
    const state = makeState(12, 10);
    const ex = exec(state);
    brushAt(state, ex, { x: 5, y: 5 }, 1); // an existing layer-1 cell the new stroke will cross

    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1, 1); // floor 1
    const seen: (number | null)[] = [];
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    ctx.setDisplayLayer = (n) => seen.push(n);

    tool.onPointerDown(cell(m(3, 5)), point(m(3, 5)), ctx);  // fresh → 1
    tool.onPointerMove(cell(m(5, 5)), point(m(5, 5)), ctx);  // crosses the layer-1 cell → stacks to 2
    tool.onPointerMove(cell(m(7, 5)), point(m(7, 5)), ctx);  // fresh → 1 (last painted cell)
    tool.onPointerUp(cell(m(8, 5)), point(m(8, 5)), ctx);    // release drifts past the last painted cell

    expect(elevAt(state, 5, 5)).toBe(2); // the crossed cell did stack
    expect(elevAt(state, 7, 5)).toBe(1);
    // Released on fresh ground: highlight must stay on the floor, not jump to 2.
    expect(seen[seen.length - 1]).toBe(1);
  });
});

// A fast freehand drag fires few pointer samples; the brush must fill the whole path between them so the
// stroke is a continuous edge-connected band — not isolated blocks joined by a diagonal.
describe('DrawingTool: fast-drag continuity', () => {
  it('a single far move paints every cell on the 4-connected path (no gaps)', () => {
    const state = makeState(12, 12);
    const ex = exec(state);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1, 1);
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(2, 2)), point(m(2, 2)), ctx);  // start
    tool.onPointerMove(cell(m(7, 5)), point(m(7, 5)), ctx);  // One fast jump (+5, +3) — no intermediate samples
    tool.onPointerUp(cell(m(7, 5)), point(m(7, 5)), ctx);
    // every cell along the interpolated 4-connected path is painted, not only the endpoints
    for (const p of line4(2, 2, 7, 5)) expect(elevAt(state, p.x, p.y), `(${p.x},${p.y}) painted`).toBe(1);
  });
});

// Atomic undo: with auto-trim on, the trim/fill commands fold into the
// last block entry of the stroke — undo steps are block creations only.
describe('DrawingTool: auto-trim undo folding (ATOMIC UNDO)', () => {
  it('a click with auto-trim on undoes in ONE step (block + its trims together)', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, ex, 1, 1, { autoEdgeCut: 'round' });
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
    tool.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);

    expect(state.cells[5]![5]!.terrain?.corners, 'isolated cell got rounded').toEqual(['fan', 'fan', 'fan', 'fan']);
    expect(ex.historyDepth(), 'paint + trims = one history entry').toBe(1);
    ex.undo();
    expect(state.cells[5]![5]!.terrain ?? null, 'one undo removes the block (and its trims)').toBeNull();
  });
});
