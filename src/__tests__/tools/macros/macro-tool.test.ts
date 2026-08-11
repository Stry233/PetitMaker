/**
 * The macro tool: what a press builds, what a settled pointer previews, and what makes each press
 * its own.
 *
 * The tool reads the armed macro and the live editor from the CONTEXT — the pointer machine hands
 * it only coordinates — so the setup here builds a `ToolContext` directly: a map, a macro armed via
 * `armedMacro`, and a minimal overlay/translator for the overlay-facing assertions.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents, GridState, MacroCoord } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { MacroTool, armedMacroId } from '../../../tools/macros/macro-tool';
import { previewMacro } from '../../../tools/macros/preview';
import type { ToolContext } from '../../../tools/types';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';

function installMap(): { state: GridState; exec: CommandExecutor } {
  const state = makeState(32, 32);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, exec };
}

function ctxFor(state: GridState, exec: CommandExecutor, over: Partial<ToolContext> = {}) {
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
    expect(armedMacroId(ctxFor(state, exec).ctx)).toBe('raise');
    expect(armedMacroId(ctxFor(state, exec, { armedMacro: 'not-a-macro' }).ctx)).toBeNull();
  });
});

describe('a press', () => {
  it('lays one per press, each its own undo entry, at the cell it names', () => {
    const { state, exec } = installMap();
    const { ctx } = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    expect(exec.getUndoStackSize()).toBe(1);
    expect(state.cells[10]![10]!.terrain, 'the hill stands where the press named').toBeTruthy();

    tool.onPointerDown(at(22, 22), { x: 22, y: 22 }, ctx);
    // TWO hills stand, not one replaced by another.
    expect(exec.getUndoStackSize()).toBe(2);

    exec.undo();
    exec.undo();
    expect(exec.getUndoStackSize()).toBe(0);
  });

  it('does nothing off the buildable ground the badge already refuses', () => {
    const { state, exec } = installMap();
    const { ctx } = ctxFor(state, exec);
    const tool = new MacroTool();
    expect(tool.canActAt(at(-1, 0), ctx)).toBe(false);
    tool.onPointerDown(at(-1, 0), { x: -1, y: 0 }, ctx);
    expect(exec.getUndoStackSize()).toBe(0);
    void state;
  });
});

describe('the ghost', () => {
  it('answers a MOVING pointer: each answer draws, and the next cell is asked at once', async () => {
    const { state, exec } = installMap();
    const { ctx, overlay } = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerMove(at(10, 10), { x: 10, y: 10 }, ctx);
    // While the first answer is airborne the pointer keeps moving; the pump takes the NEWEST cell
    // when it lands, never queueing the ones crossed in between.
    tool.onPointerMove(at(12, 10), { x: 12, y: 10 }, ctx);
    tool.onPointerMove(at(14, 10), { x: 14, y: 10 }, ctx);
    await new Promise((r) => { setTimeout(r, 0); });
    expect(overlay.showGhost).toHaveBeenCalled();
    const cells = overlay.showGhost.mock.calls[0]![0] as MacroCoord[];
    expect(cells.length).toBeGreaterThan(0);
    // Two answers at most: the first cell's, then the newest — the middle cell was superseded.
    expect(overlay.showGhost.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('is cleared when the tool is put away, and an airborne answer is dropped', async () => {
    const { state, exec } = installMap();
    const { ctx, overlay } = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onPointerMove(at(10, 10), { x: 10, y: 10 }, ctx);
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
