import { describe, it, expect, vi } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { CommandType, TerrainType, type Command, type MacroCoord, type ValidationResult } from '../../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import type { HostedToolContext } from '../../../../tools/pointer/runtime/host';
import { getCatalogItem } from '../../../../state/catalog';
import { cell, point } from '../../../_support/grid';

const exec = (state: any) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });
const terrainAt = (state: any, x: number, y: number) => state.cells[y]?.[x]?.terrain ?? null;

function fillMountain(state: any, rect: { x0: number; y0: number; x1: number; y1: number }, elevation: number) {
  const { x0, y0, x1, y1 } = rect;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTerrain(state, x, y, TerrainType.Mountain, elevation);
}

/** Captures every command the tool issues, in order, before any post-stroke pass can revert one:
 *  the target layer is settled at the plan. */
function captureCommands(state: any, ex: CommandExecutor, elevation: number, brushSize = 1, pinned = false) {
  const commands: Command[] = [];
  const ctx: HostedToolContext = {
    ...makeToolCtx(state, ex, brushSize, elevation, { layerPinned: pinned }),
    execute: (cmd: Command): ValidationResult => {
      commands.push(cmd);
      return ex.execute(cmd);
    },
  };
  return { ctx, commands };
}

function waterBrush(ctx: HostedToolContext, x: number, y: number): void {
  const tool = new DrawingTool();
  arm(ctx, { contentType: 'water', shape: 'free' });
  tool.onPointerDown(cell(m(x, y)), point(m(x, y)), ctx);
  tool.onPointerUp(cell(m(x, y)), point(m(x, y)), ctx);
}

/** A freehand stroke through the given cells: press on the first, travel through the rest. */
function waterStroke(ctx: HostedToolContext, path: MacroCoord[]): void {
  const tool = new DrawingTool();
  arm(ctx, { contentType: 'water', shape: 'free' });
  const first = path[0]!;
  tool.onPointerDown(cell(first), point(first), ctx);
  for (const c of path.slice(1)) tool.onPointerMove(cell(c), point(c), ctx);
  const last = path[path.length - 1]!;
  tool.onPointerUp(cell(last), point(last), ctx);
}

/** The elevation each command carried, per cell it carried. */
function layerByCell(commands: Command[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const cmd of commands) {
    if (cmd.type !== CommandType.PaintTerrain) continue;
    for (const c of cmd.cells) out.set(`${c.x},${c.y}`, cmd.elevation);
  }
  return out;
}

/**
 * A solid plateau at 3 with one cell occupied, so V-PLACE-BLOCK refuses terrain there for a reason
 * other than height. At 4 or more the plateau would owe V-MTN-03's 3x3 base at its coast and the
 * whole-map post-stroke pass would revert the stroke.
 */
function occupiedPlateau(ex: CommandExecutor, state: any, at: MacroCoord): void {
  fillMountain(state, { x0: 2, y0: 2, x1: 8, y1: 8 }, 3);
  const item = getCatalogItem('building-stall')!;
  ex.execute({
    type: CommandType.PlaceObject,
    object: { id: 'fixture-stall', catalogId: item.id, position: at, rotation: 0, elevation: 3 },
  });
}

describe('DrawingTool: with no layer pinned, water follows the ground under it', () => {
  it('lands on a plateau top even though a lower layer is selected, and survives containment', () => {
    const state = makeState(10, 10);
    // Water in the plateau's centre at its own elevation is contained: no exposed face.
    fillMountain(state, { x0: 3, y0: 3, x1: 7, y1: 7 }, 3);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 1); // panel says layer 1
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5)).toEqual({ type: TerrainType.Water, elevation: 3 });
  });

  it('drops to ground level (0) when the click is on fresh ground, even under a raised selection', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 5); // panel says layer 5
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5)).toEqual({ type: TerrainType.Water, elevation: 0 });
  });

  // An automatic layer is a highlight (`setDisplayLayer`), never the build floor, or the next stroke
  // would be pinned to a layer nobody picked.
  it('reports where the water landed as a panel HIGHLIGHT, and never moves the build floor', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    const ex = exec(state);
    const setDisplayLayer = vi.fn();
    const ctx = { ...makeToolCtx(state, ex, 1, 1), setDisplayLayer };
    waterBrush(ctx, 5, 5);
    expect(setDisplayLayer).toHaveBeenCalledWith(4);
    expect(ctx.arming.floor, 'the build floor is untouched').toBe(1);
  });

  it('reads the REAL surface through the silhouette kernel: a Γ-patched corner reads its real (lower) support, not its cosmetic tier', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    const cell = state.cells[5]![5]!.terrain!;
    (cell as any).patchOnly = true;
    (cell as any).patchBase = 2; // cosmetic tier 3, real support 2
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1);
    waterBrush(ctx, 5, 5);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 2 });
  });

  // ToolManager does not refresh ctx between pointer-down and the synchronous paint call, so this
  // drives the raw HostedToolContext: a layer resolved only in the store would leave the stale
  // elevation (1) on the first command.
  it('the FIRST command of the stroke already carries the resolved layer (no stale first cell)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1);
    waterBrush(ctx, 5, 5);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 3 });
  });

  // Planned at the clicked layer alone, the far side of a step would be refused.
  it('a footprint spanning a step splits: one command per layer, each carrying its own cells', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3); // one raised cell in the middle of the dab
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1, 3);
    waterBrush(ctx, 5, 5);
    const byCell = layerByCell(commands);
    expect(byCell.get('5,5'), 'the raised cell takes water at its own surface').toBe(3);
    expect(byCell.get('4,4'), 'the ground around it takes water at ground level').toBe(0);
    expect(new Set(commands.map((c: any) => c.elevation))).toEqual(new Set([0, 3]));
  });

  it('a stroke down a terraced slope lays water on every terrace, at that terrace\'s own level', () => {
    const state = makeState(12, 12);
    // Three steps side by side: ground, 1, 2.
    setTerrain(state, 3, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 5, TerrainType.Mountain, 2);
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1);
    waterStroke(ctx, [m(2, 5), m(3, 5), m(4, 5)]);
    const byCell = layerByCell(commands);
    expect(byCell.get('2,5')).toBe(0);
    expect(byCell.get('3,5')).toBe(1);
    expect(byCell.get('4,5')).toBe(2);
  });

  it('the cursor probe (canActAt) agrees with the click: both resolve the SAME per-cell layer', () => {
    const state = makeState(10, 10);
    fillMountain(state, { x0: 3, y0: 3, x1: 7, y1: 7 }, 3);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 1); // panel says layer 1; the surface under the cursor is 3
    const tool = new DrawingTool();
    arm(ctx, { contentType: 'water', shape: 'free' });
    expect(tool.canActAt(cell(m(5, 5)), ctx)).toBe(true);
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5)).toEqual({ type: TerrainType.Water, elevation: 3 });
  });

  // Planned at the clicked layer, the eight ground cells would fail V-WTR-01 and take the whole
  // command with them.
  it('a dab over a lone raised cell still fills the ground around it', () => {
    const state = makeState(12, 12);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 3, 1);
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 4, 4), 'ground water, at ground level').toEqual({ type: TerrainType.Water, elevation: 0 });
    expect(terrainAt(state, 5, 4)).toEqual({ type: TerrainType.Water, elevation: 0 });
    // The raised cell's water at 3 has no bank, so the post-stroke pass reverts that command alone.
    expect(terrainAt(state, 5, 5), 'the unbankable cell alone goes back').toEqual({ type: TerrainType.Mountain, elevation: 3 });
  });
});

// A pinned layer outranks the ground wherever the ground can hold it; where it would float, the
// stroke follows the ground instead.
describe('DrawingTool: with a layer PINNED, water paints at that layer wherever the ground reaches it', () => {
  it('paints the pinned layer over the whole footprint that can hold it, and skips the cell that cannot', () => {
    const state = makeState(12, 12);
    const ex = exec(state);
    occupiedPlateau(ex, state, m(6, 5));
    const ctx = makeToolCtx(state, ex, 3, 3, { layerPinned: true });
    waterBrush(ctx, 6, 5);
    expect(terrainAt(state, 5, 5), 'beside the refused cell').toEqual({ type: TerrainType.Water, elevation: 3 });
    expect(terrainAt(state, 7, 4), 'and the far corner of the dab').toEqual({ type: TerrainType.Water, elevation: 3 });
    // Skipped without taking the rest of the dab with it.
    expect(terrainAt(state, 6, 5), 'the occupied cell keeps its mountain').toEqual({ type: TerrainType.Mountain, elevation: 3 });
  });

  it('ignores the ground under the cursor: a plateau click still plans the pinned layer', () => {
    const state = makeState(12, 12);
    fillMountain(state, { x0: 2, y0: 2, x1: 8, y1: 8 }, 3);
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1, 1, true); // pinned to layer 1; the surface is 3
    waterBrush(ctx, 5, 5);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 1 });
  });

  // Skipping where the pin would float would break a lake into puddles on whichever terraces reach.
  it('follows the ground where the pinned layer would float, and the probe says so before the click', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 5, { layerPinned: true }); // layer 5 over fresh ground
    const tool = new DrawingTool();
    arm(ctx, { contentType: 'water', shape: 'free' });
    expect(tool.canActAt(cell(m(5, 5)), ctx), 'the fallback is legal, so the badge must not refuse').toBe(true);
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5), 'ground water, not nothing').toEqual({ type: TerrainType.Water, elevation: 0 });
  });

  // The fallback is drawn at V-WTR-01's line, not "below the pin": a terrace one step down is what a
  // pinned lake stands on.
  it('keeps the pin on a terrace one step below it: that is where a pinned lake sits', () => {
    const state = makeState(12, 12);
    fillMountain(state, { x0: 2, y0: 2, x1: 8, y1: 8 }, 2);
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 3, 1, true); // pinned 3, surface 2
    waterBrush(ctx, 5, 5);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 3 });
  });

  it('one stroke, both: the pinned layer on the terrace and the ground level off it', () => {
    const state = makeState(14, 14);
    fillMountain(state, { x0: 2, y0: 2, x1: 8, y1: 8 }, 3); // the terrace ends at x=8; x=9 is ground
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 3, 3, true);
    waterBrush(ctx, 8, 5);
    const byCell = layerByCell(commands);
    expect(byCell.get('7,5'), 'on the terrace, the pinned layer').toBe(3);
    expect(byCell.get('8,5')).toBe(3);
    expect(byCell.get('9,5'), 'off it, where 3 would float, the ground').toBe(0);
  });

  // The pin is not what is wrong there (the cell's surface is the pinned layer), so it is skipped,
  // not moved.
  it('still skips a cell refused for a reason that is not the height', () => {
    const state = makeState(12, 12);
    const ex = exec(state);
    occupiedPlateau(ex, state, m(6, 5));
    const ctx = makeToolCtx(state, ex, 1, 3, { layerPinned: true });
    waterBrush(ctx, 6, 5);
    expect(terrainAt(state, 6, 5)).toEqual({ type: TerrainType.Mountain, elevation: 3 });
  });

  it('the panel highlight follows the pin, not the ground', () => {
    const state = makeState(12, 12);
    fillMountain(state, { x0: 2, y0: 2, x1: 8, y1: 8 }, 3);
    const ex = exec(state);
    const setDisplayLayer = vi.fn();
    const ctx = { ...makeToolCtx(state, ex, 1, 2, { layerPinned: true }), setDisplayLayer };
    waterBrush(ctx, 5, 5);
    expect(setDisplayLayer).toHaveBeenCalledWith(2);
    expect(setDisplayLayer).not.toHaveBeenCalledWith(3);
  });
});

// Mountain auto-stacks from the selected floor, whatever the pin.
describe('DrawingTool: only water changes; mountain still floors from the SELECTED layer', () => {
  it('a mountain click still uses the selected floor, not the clicked surface', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 2); // panel selects layer 2 (no 3x3-base cap in play)
    const tool = new DrawingTool();
    arm(ctx, { contentType: 'mountain', shape: 'free' });
    tool.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
    tool.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);
    // The selected floor (2), not the clicked surface (1).
    expect(terrainAt(state, 5, 5)?.elevation).toBe(2);
  });

  it('reads the same floor pinned or not: the pin is a water fact only', () => {
    for (const layerPinned of [false, true]) {
      const state = makeState(10, 10);
      const ex = exec(state);
      const ctx = makeToolCtx(state, ex, 1, 2, { layerPinned });
      const tool = new DrawingTool();
      arm(ctx, { contentType: 'mountain', shape: 'free' });
      tool.onPointerDown(cell(m(5, 5)), point(m(5, 5)), ctx);
      tool.onPointerUp(cell(m(5, 5)), point(m(5, 5)), ctx);
      expect(terrainAt(state, 5, 5)?.elevation, `pinned: ${layerPinned}`).toBe(2);
    }
  });
});
