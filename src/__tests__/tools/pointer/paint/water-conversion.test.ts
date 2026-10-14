/**
 * Water converts existing terrain rather than excavating it.
 *
 * The water eraser paints mountain at the water's own elevation: the cell becomes this layer's terrain
 * and is itself the bank that keeps its neighbours legal. Digging the cell to bare ground instead
 * unbanks the water beside it, the containment rule refuses the stroke whole, and the edge of a
 * waterfall can never be taken back. The mountain brush takes the same stance: water is changed to
 * terrain in place, never treated as a floor to stack on.
 */
import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type Command, type GridState } from '../../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { peelCommand } from '../../../../tools/placement/terrain-peel';
import { planPaint } from '../../../../tools/pointer/paint/paint-plan';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { makeToolCtx, testArming } from '../../../_support/tool-ctx';
import type { ToolContext } from '../../../../tools/pointer/runtime/types';
import { cell, point } from '../../../_support/grid';

const exec = (s: GridState) => makeExecutor(s);

/** The one ToolContext field planPaint reads, plus the build floor. */
const ctxFor = (state: GridState, elevation: number): ToolContext =>
  ({ state, arming: testArming({ floor: elevation }) } as unknown as ToolContext);

/** A tier-3 pool: a 5x5 mountain@3 block whose two centre cells hold water@3. */
function pool(): GridState {
  const state = makeState(12, 12);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
  setTerrain(state, 4, 4, TerrainType.Water, 3);
  setTerrain(state, 5, 4, TerrainType.Water, 3);
  return state;
}

describe('the water eraser converts', () => {
  it('turns an edge water cell into this layer\'s mountain, and the stroke commits clean', () => {
    const state = pool();
    const ex = exec(state);
    const start = ex.beginStroke();
    const cmd = peelCommand(4, 4, state.cells[4]![4]!, { waterEraser: true })!;
    expect(cmd.type).toBe(CommandType.PaintTerrain);
    expect(ex.execute(cmd).success).toBe(true);
    expect(start.commit(), 'the containment rule stays satisfied').toEqual([]);
    const cell = state.cells[4]![4]!.terrain!;
    expect(cell.type).toBe(TerrainType.Mountain);
    expect(cell.elevation, 'the water\'s own elevation').toBe(3);
    expect(state.cells[4]![5]!.terrain!.type, 'the remaining water survives, banked by the convert').toBe(TerrainType.Water);
  });

  it('digging the same cell instead is what the containment rule refuses', () => {
    const state = pool();
    const ex = exec(state);
    const start = ex.beginStroke();
    const dig = peelCommand(4, 4, state.cells[4]![4]!)!;
    expect(dig.type).toBe(CommandType.EraseTerrain);
    ex.execute(dig);
    expect(start.commit().length, 'unbanked water violates containment').toBeGreaterThan(0);
  });

  it('converts ground-level water to bare grass (mountain at 0 clears)', () => {
    const state = makeState(8, 8);
    setTerrain(state, 3, 3, TerrainType.Water, 0);
    const ex = exec(state);
    const cmd = peelCommand(3, 3, state.cells[3]![3]!, { waterEraser: true })!;
    expect(ex.execute(cmd).success).toBe(true);
    expect(state.cells[3]![3]!.terrain).toBeNull();
  });

  it('keeps the mountain-mode dig unchanged', () => {
    const state = makeState(8, 8);
    setTerrain(state, 3, 3, TerrainType.Water, 0);
    expect(peelCommand(3, 3, state.cells[3]![3]!)!.type).toBe(CommandType.EraseTerrain);
  });
});

describe('the mountain brush converts water in place', () => {
  it('paints mountain AT the water\'s elevation, never a block above it', () => {
    const state = pool();
    const { commands } = planPaint([{ x: 4, y: 4 }], ctxFor(state, 1), 'mountain', new Set());
    const paints = commands.filter((c): c is Extract<Command, { type: CommandType.PaintTerrain }> => c.type === CommandType.PaintTerrain);
    expect(paints.length).toBe(1);
    expect(paints[0]!.elevation, 'conversion, not a stack on a water floor').toBe(3);
    const ex = exec(state);
    const start = ex.beginStroke();
    for (const c of commands) expect(ex.execute(c).success).toBe(true);
    expect(start.commit()).toEqual([]);
    expect(state.cells[4]![4]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 3 });
  });

  it('converts and keeps filling when the build floor is higher', () => {
    const state = pool();
    const { commands } = planPaint([{ x: 4, y: 4 }], ctxFor(state, 4), 'mountain', new Set());
    const levels = commands.map((c) => (c.type === CommandType.PaintTerrain ? c.elevation : -1));
    expect(levels).toEqual([3, 4]);
  });

  it('a second click on the converted cell stacks normally', () => {
    const state = pool();
    const ex = exec(state);
    for (const c of planPaint([{ x: 4, y: 4 }], ctxFor(state, 1), 'mountain', new Set()).commands) ex.execute(c);
    const { commands } = planPaint([{ x: 4, y: 4 }], ctxFor(state, 1), 'mountain', new Set());
    expect(commands.map((c) => (c.type === CommandType.PaintTerrain ? c.elevation : -1))).toEqual([4]);
  });
});

describe('the eraser erases its own surface', () => {
  const drive = (state: GridState, mode: 'water' | 'mountain', x: number, y: number) => {
    const ex = exec(state);
    const issued: Command[] = [];
    const tool = new EraserTool();
    const ctx = makeToolCtx(state, ex, 1, 1, {
      contentType: mode,
      execute: (c: Command) => { issued.push(c); return ex.execute(c); },
    });
    tool.onPointerDown(cell({ x, y }), point({ x, y }), ctx);
    tool.onPointerUp(cell({ x, y }), point({ x, y }), ctx);
    return issued;
  };

  it('the water eraser skips mountain cells', () => {
    const state = makeState(8, 8);
    setTerrain(state, 3, 3, TerrainType.Mountain, 2);
    expect(drive(state, 'water', 3, 3)).toEqual([]);
    expect(state.cells[3]![3]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('the mountain eraser skips water cells', () => {
    const state = makeState(8, 8);
    setTerrain(state, 3, 3, TerrainType.Water, 0);
    expect(drive(state, 'mountain', 3, 3)).toEqual([]);
    expect(state.cells[3]![3]!.terrain).toMatchObject({ type: TerrainType.Water });
  });

  it('each eraser still takes back its own surface', () => {
    const state = makeState(8, 8);
    setTerrain(state, 3, 3, TerrainType.Water, 0);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    expect(drive(state, 'water', 3, 3).length).toBe(1);
    expect(state.cells[3]![3]!.terrain).toBeNull();
    expect(drive(state, 'mountain', 5, 5).length).toBe(1);
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });
});
