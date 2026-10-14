// @vitest-environment jsdom
/**
 * The eraser's batch shapes: a rectangle or a circle dragged out and taken on release, beside the
 * dab it has always had. They are the drawing tool's own figures (`core/grid/shapes.ts:dragShapeCells`), so
 * the eraser takes back exactly what the brush lays.
 */
import { describe, it, expect } from 'vitest';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const exec = (state: GridState) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });

/** A flat field of layer-1 mountain, so every cell is erasable and nothing is refused for support. */
function field(w = 16, h = 16): GridState {
  const state = makeState(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  return state;
}

const cleared = (state: GridState): number => {
  let n = 0;
  for (const row of state.cells) for (const cell of row) if (!cell?.terrain) n++;
  return n;
};

/** Drive one gesture: press at `from`, drag to `to`, release. */
function drag(state: GridState, shape: 'free' | 'rect' | 'circle', from: MacroCoord, to: MacroCoord, constrain = false) {
  const ctx = makeToolCtx(state, exec(state), 1, 1, { eraserShape: shape, modifiers: { constrain, multiSelect: false } });
  const eraser = new EraserTool();
  eraser.onPointerDown(cell(from), point(from), ctx);
  eraser.onPointerMove(cell(to), point(to), ctx);
  eraser.onPointerUp(cell(to), point(to), ctx);
}

describe('EraserTool: batch shapes', () => {
  it('takes back the whole rectangle a drag encloses', () => {
    const state = field();
    drag(state, 'rect', m(3, 3), m(7, 6));
    expect(cleared(state)).toBe(5 * 4); // inclusive of both corners
    expect(state.cells[3]![3]!.terrain).toBeNull();
    expect(state.cells[6]![7]!.terrain).toBeNull();
    expect(state.cells[2]![3]!.terrain).not.toBeNull(); // outside
  });

  it('takes back a circle, and nothing outside it', () => {
    const state = field();
    drag(state, 'circle', m(8, 8), m(11, 11));
    const n = cleared(state);
    expect(n).toBeGreaterThan(0);
    expect(state.cells[8]![8]!.terrain).toBeNull();  // the centre
    expect(state.cells[8]![12]!.terrain).not.toBeNull(); // past the radius on the axis
    // A disc, not the square it was dragged out of: its corner cell survives.
    expect(state.cells[11]![11]!.terrain).not.toBeNull();
    expect(n).toBeLessThan(7 * 7);
  });

  it('is not committed until the release, so a drag can still be re-aimed', () => {
    const state = field();
    const ctx = makeToolCtx(state, exec(state), 1, 1, { eraserShape: 'rect' });
    const eraser = new EraserTool();
    eraser.onPointerDown(cell(m(3, 3)), point(m(3, 3)), ctx);
    eraser.onPointerMove(cell(m(9, 9)), point(m(9, 9)), ctx);
    expect(cleared(state)).toBe(0); // still only a ghost
    eraser.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);
    expect(cleared(state)).toBe(3 * 3); // the release decides, not the travel
  });

  it('Shift squares a rectangle off, exactly as it does for the brush', () => {
    const state = field();
    drag(state, 'rect', m(2, 2), m(8, 4), true);
    // The longer leg wins: a 7x7 square, not the 7x3 the pointer described.
    expect(cleared(state)).toBe(7 * 7);
    expect(state.cells[8]![8]!.terrain).toBeNull();
  });

  it('the dab is untouched: it erases as it travels, under the brush', () => {
    const state = field();
    const ctx = makeToolCtx(state, exec(state), 1, 1, { eraserShape: 'free' });
    const eraser = new EraserTool();
    eraser.onPointerDown(cell(m(4, 4)), point(m(4, 4)), ctx);
    expect(cleared(state)).toBe(1); // taken on the press, not held for the release
    eraser.onPointerMove(cell(m(5, 4)), point(m(5, 4)), ctx);
    expect(cleared(state)).toBe(2);
    eraser.onPointerUp(cell(m(5, 4)), point(m(5, 4)), ctx);
    expect(cleared(state)).toBe(2);
  });

  it('a whole shape is ONE undo step', () => {
    const state = field();
    const e = exec(state);
    const ctx = makeToolCtx(state, e, 1, 1, { eraserShape: 'rect' });
    const before = e.historyDepth();
    const eraser = new EraserTool();
    eraser.onPointerDown(cell(m(3, 3)), point(m(3, 3)), ctx);
    eraser.onPointerMove(cell(m(6, 6)), point(m(6, 6)), ctx);
    eraser.onPointerUp(cell(m(6, 6)), point(m(6, 6)), ctx);
    expect(cleared(state)).toBe(16);
    expect(e.historyDepth()).toBe(before + 1);
  });
});
