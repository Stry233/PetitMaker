/**
 * Smart planting: the spray, and the per-tier adaptation.
 *
 * A held press keeps planting — one burst now, one per clock tick, one per few cells of travel —
 * and the WHOLE hold folds to one undo entry, so undo takes back the gesture rather than a puff
 * of it. A disc over mixed elevations plants every tier as its own confined ecology run: run
 * once over all of them, the terraces' narrow bands starve inside the stand noise's glades.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { TerrainType, type EditorEvents, type GridState, type MacroCoord } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { applyMacro } from '../../../tools/macros';
import { MacroTool } from '../../../tools/macros/macro-tool';
import type { ToolContext } from '../../../tools/types';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';

function installMap(size = 40): { state: GridState; exec: CommandExecutor } {
  const state = makeState(size, size);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, exec };
}

function ctxFor(state: GridState, exec: CommandExecutor): ToolContext {
  return makeToolCtx(state, exec, undefined, undefined, {
    armedMacro: 'patch-tree',
    overlay: { showGhost: vi.fn(), clearGhost: vi.fn() } as unknown as ToolContext['overlay'],
  });
}

const at = (x: number, y: number): MacroCoord => ({ x, y });

afterEach(() => {
  vi.useRealTimers();
});

describe('the spray', () => {
  it('keeps planting while held, and the whole hold is ONE undo entry', () => {
    vi.useFakeTimers();
    const { state, exec } = installMap();
    const ctx = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    const afterFirst = state.objects.size;
    expect(afterFirst).toBeGreaterThan(0);

    // The clock sprays under a resting pointer…
    vi.advanceTimersByTime(800);
    // …and a move far enough sprays without waiting.
    tool.onPointerMove(at(20, 20), { x: 20, y: 20 }, ctx);
    expect(state.objects.size).toBeGreaterThan(afterFirst);

    tool.onPointerUp(at(20, 20), { x: 20, y: 20 }, ctx);
    expect(exec.getUndoStackSize(), 'the hold folds to one entry').toBe(1);

    exec.undo();
    expect(state.objects.size, 'one undo takes the whole gesture back').toBe(0);
  });

  it('stops with the tool: deactivation mid-hold folds and ends the clock', () => {
    vi.useFakeTimers();
    const { state, exec } = installMap();
    const ctx = ctxFor(state, exec);
    const tool = new MacroTool();
    tool.onActivate();
    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    tool.onDeactivate(ctx);
    const settled = state.objects.size;
    vi.advanceTimersByTime(2000);
    expect(state.objects.size, 'no burst after the tool was put away').toBe(settled);
    expect(exec.getUndoStackSize()).toBe(1);
  });
});

describe('per-tier planting', () => {
  it('plants every terrace of a slope, each as its own run', () => {
    const { state, exec } = installMap();
    // A terraced cone: elevation rings 1..4 around the centre.
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const d = Math.max(Math.abs(x - 20), Math.abs(y - 20));
      const e = Math.max(0, 4 - Math.floor(d / 3));
      for (let k = 1; k <= e; k++) setTerrain(state, x, y, TerrainType.Mountain, k);
    }
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const out = applyMacro(ctx, 'patch-tree', { seed: 5, at: at(26, 20), radius: 6 });
    expect(out.changes).toBeGreaterThan(0);
    const tiers = new Set([...state.objects.values()].map((o) => o.elevation));
    // The disc spans tiers 1..4; every one of them received its own stand.
    expect([...tiers].sort()).toEqual([1, 2, 3, 4]);
  });
});
