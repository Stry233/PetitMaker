/**
 * The macro tool: what a press builds, what a settled pointer previews, and what makes each press
 * its own.
 *
 * The tool reads the armed macro and the live editor from the context — the pointer machine hands
 * it only coordinates — so the setup here builds a `ToolContext` directly: a map, a macro armed via
 * `armedMacro`, and a minimal overlay/translator for the overlay-facing assertions.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import type { GridState, MacroCoord } from '../../../../core/model/types';
import { MacroTool } from '../../../../tools/pointer/macros/macro-tool';
import { MACROS } from '../../../../tools/macros/run';
import { PLACEMENT_GRID } from '../../../../core/game/profile';
import { previewMacro } from '../../../../tools/macros/runtime/preview';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, type ToolCtxOver } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

function installMap(): { state: GridState; exec: CommandExecutor } {
  const state = makeState(32, 32);
  const exec = makeExecutor(state);
  return { state, exec };
}

function ctxFor(state: GridState, exec: CommandExecutor, over: ToolCtxOver = {}) {
  const overlay = { showGhost: vi.fn(), clearGhost: vi.fn() };
  const ctx = makeToolCtx(state, exec, 1, 1, { armedMacro: 'raise', overlay: overlay as any, ...over });
  return { ctx, overlay };
}

const at = (x: number, y: number): MacroCoord => ({ x, y });

afterEach(() => {
  vi.useRealTimers();
});

describe('arming', () => {
  it('narrows the context string to a macro the engine implements', () => {
    const { state, exec } = installMap();
    // The tool works on the armed macro's grid, and on the placement grid with none it implements.
    const tool = new MacroTool();
    expect(MACROS.raise.grid).not.toBe(PLACEMENT_GRID);
    expect(tool.grid(ctxFor(state, exec).ctx)).toBe(MACROS.raise.grid);
    expect(tool.grid(ctxFor(state, exec, { armedMacro: 'not-a-macro' }).ctx)).toBe(PLACEMENT_GRID);
  });
});

describe('a press', () => {
  it('lays one per press, each its own undo entry, at the cell it names', () => {
    const { state, exec } = installMap();
    const { ctx } = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown(cell(at(10, 10)), point({ x: 10, y: 10 }), ctx);
    tool.onPointerUp(cell(at(10, 10)), point({ x: 10, y: 10 }), ctx);
    expect(exec.historyDepth()).toBe(1);
    expect(state.cells[10]![10]!.terrain?.elevation).toBe(2);

    tool.onPointerDown(cell(at(22, 22)), point({ x: 22, y: 22 }), ctx);
    tool.onPointerUp(cell(at(22, 22)), point({ x: 22, y: 22 }), ctx);
    expect(state.cells[22]![22]!.terrain?.elevation).toBe(2);
    expect(exec.historyDepth()).toBe(2);

    exec.undo();
    exec.undo();
    expect(exec.historyDepth()).toBe(0);
  });

  it('does nothing off the buildable ground the badge already refuses', () => {
    const { state, exec } = installMap();
    const { ctx } = ctxFor(state, exec);
    const tool = new MacroTool();
    expect(tool.canActAt(cell(at(-1, 0)), ctx)).toBe(false);
    tool.onPointerDown(cell(at(-1, 0)), point({ x: -1, y: 0 }), ctx);
    expect(exec.historyDepth()).toBe(0);
    void state;
  });
});

describe('the ghost', () => {
  it('coalesces pointer movement into the latest local footprint preview', async () => {
    const { state, exec } = installMap();
    const { ctx, overlay } = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerMove(cell(at(10, 10)), point({ x: 10, y: 10 }), ctx);
    tool.onPointerMove(cell(at(12, 10)), point({ x: 12, y: 10 }), ctx);
    tool.onPointerMove(cell(at(14, 10)), point({ x: 14, y: 10 }), ctx);
    await new Promise((r) => { setTimeout(r, 0); });
    expect(overlay.showGhost).toHaveBeenCalled();
    const cells = (overlay.showGhost.mock.calls[0]![0] as { cells: MacroCoord[] }).cells;
    expect(cells.length).toBeGreaterThan(0);
    expect(overlay.showGhost).toHaveBeenCalledTimes(1);
    expect(exec.historyDepth()).toBe(0);
  });

  it('is cleared when the tool is put away, and an airborne answer is dropped', async () => {
    const { state, exec } = installMap();
    const { ctx, overlay } = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onPointerMove(cell(at(10, 10)), point({ x: 10, y: 10 }), ctx);
    tool.onDeactivate(ctx);
    await new Promise((r) => { setTimeout(r, 0); });
    expect(overlay.showGhost).not.toHaveBeenCalled();
    expect(overlay.clearGhost).toHaveBeenCalled();
  });
});

describe('the preview cache', () => {
  it('answers the same question from the same map without a second run', () => {
    const { state, exec } = installMap();
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const first = previewMacro(ctx, 'raise', { seed: 1, at: at(10, 10) });
    const second = previewMacro(ctx, 'raise', { seed: 1, at: at(10, 10) });
    expect(second).toBe(first);
    // A different seed is a different question.
    expect(previewMacro(ctx, 'raise', { seed: 2, at: at(10, 10) })).not.toBe(first);
  });
});
