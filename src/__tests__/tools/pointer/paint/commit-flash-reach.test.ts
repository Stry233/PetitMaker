/**
 * The commit flash acknowledges what the commit changed, which is not the same set as what the
 * stroke painted: with auto-trim on, the pass sweeps the stroke's 8-neighbourhood, so a block just
 * outside the shape can round and a notch just outside it can gain a Γ patch. A flash over the
 * painted cells alone stops at the shape's outline while the map changed past it.
 *
 * Only the discrete shape tools flash (a freehand brush commits continuously), so the stroke here
 * is a rect drag.
 */
import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { getCell } from '../../../../core/model/grid-model';
import type { CellSet } from '../../../../core/grid/grids';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const exec = (state: any) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });

/** Drag a rect from a to b with the given trim mode; returns what the commit flashed. */
function rectStroke(
  state: any, from: MacroCoord, to: MacroCoord, autoEdgeCut: 'off' | 'round',
): { cells: MacroCoord[]; grid: string } | null {
  let flashed: { cells: MacroCoord[]; grid: string } | null = null;
  const overlay = {
    showGhost() {}, showGhostSpans() {}, clearGhost() {},
    flashCommit(sets: readonly CellSet[]) {
      flashed = { cells: sets.flatMap((s) => s.cells.map((c) => ({ ...c }))), grid: sets.map((s) => s.grid).join(',') };
    },
  };
  const tool = new DrawingTool();
  const ctx = makeToolCtx(state, exec(state), 1, 1, { autoEdgeCut, overlay: overlay as never });
  arm(ctx, { contentType: 'mountain', shape: 'rect' });
  tool.onPointerDown(cell(from), point(from), ctx);
  tool.onPointerMove(cell(to), point(to), ctx);
  tool.onPointerUp(cell(to), point(to), ctx);
  return flashed;
}

const has = (cells: MacroCoord[], x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);

describe('the commit flash covers what the commit changed', () => {
  it('flashes the painted shape on the terrain grid', () => {
    const state = makeState(12, 12);
    const flash = rectStroke(state, m(3, 3), m(4, 4), 'off')!;
    expect(flash.grid).toBe('terrain');
    expect(flash.cells).toHaveLength(4);
    expect(has(flash.cells, 3, 3)).toBe(true);
    expect(has(flash.cells, 4, 4)).toBe(true);
  });

  it('includes a block outside the shape that the stroke\'s own trim pass rounded', () => {
    // An older block at (6,6) sits diagonally off the rect (3,3)..(5,5). Painting the rect makes
    // its corner newly convex, the sweep rounds it, and the flash has to say so.
    const state = makeState(12, 12);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    const flash = rectStroke(state, m(3, 3), m(5, 5), 'round')!;
    expect(getCell(state.cells, 6, 6)!.terrain!.corners!.some((c) => c !== 'square')).toBe(true);
    expect(has(flash.cells, 6, 6)).toBe(true);
    expect(flash.cells).toHaveLength(new Set(flash.cells.map((c) => `${c.x},${c.y}`)).size); // no duplicates
  });

  it('includes a notch outside the shape that the trim filled with a Γ patch', () => {
    // The rect leaves an L around (6,5): a patch materialises there, a cell the stroke never
    // painted. It is new mass on the map, so the acknowledgement covers it.
    const state = makeState(12, 12);
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    setTerrain(state, 7, 5, TerrainType.Mountain, 1);
    const flash = rectStroke(state, m(3, 3), m(5, 5), 'round')!;
    expect(getCell(state.cells, 6, 5)!.terrain!.patchOnly).toBe(true);
    expect(has(flash.cells, 6, 5)).toBe(true);
    // and the painted shape is never dropped in the process
    expect(has(flash.cells, 3, 3)).toBe(true);
  });

  it('flashes only the shape when auto-trim is off', () => {
    const state = makeState(12, 12);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    const flash = rectStroke(state, m(3, 3), m(5, 5), 'off')!;
    expect(has(flash.cells, 6, 6)).toBe(false);
    expect(flash.cells).toHaveLength(9);
  });
});
