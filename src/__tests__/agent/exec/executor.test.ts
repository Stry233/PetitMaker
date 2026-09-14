import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import type { EditorEvents } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';
import { TOOL_SCHEMAS, WRITE_TOOLS, type AgentToolDeps } from '../../../agent/tools/tools';
import { createExecutor, wireSchemas, WIDE_TOOLS } from '../../../agent/exec/executor';
import { shouldGate } from '../../../agent/core/gates';

function setup(w = 20, h = 20) {
  const state = makeState(w, h);
  const bus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}

describe('exec/executor', () => {
  it('a read tool runs clean and never touches the undo stack', async () => {
    const { exec, deps } = setup();
    const executor = createExecutor(deps);
    const before = exec.getUndoStackSize();
    const r = await executor.execute({ callId: 't1', name: 'inspect_region', args: { x1: 0, y1: 0, x2: 2, y2: 2 } });
    expect(r.isError).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before);
  });

  it('paint_terrain lands one undo step and the result carries detail.cells', async () => {
    const { exec, deps } = setup();
    const executor = createExecutor(deps);
    const before = exec.getUndoStackSize();
    const r = await executor.execute({
      callId: 't2', name: 'paint_terrain',
      args: { rect: { x1: 2, y1: 2, x2: 4, y2: 4 }, terrain: 'mountain', elevation: 1 },
    });
    expect(r.isError).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before + 1);
    expect(r.detail?.cells).toBeGreaterThan(0);
  });

  it("isWrite mirrors the tool layer's own WRITE_TOOLS set for every schema name", () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    for (const s of TOOL_SCHEMAS) {
      expect(executor.isWrite(s.name)).toBe(WRITE_TOOLS.has(s.name));
    }
  });

  it('isWide is exactly the five wide names, delegation and history among them', () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const wide = TOOL_SCHEMAS.filter((s) => executor.isWide(s.name)).map((s) => s.name).sort();
    expect(wide).toEqual(['build_road_network', 'clear_area', 'delegate_task', 'redo', 'undo']);
    expect(WIDE_TOOLS).toEqual(new Set(['clear_area', 'build_road_network', 'delegate_task', 'undo', 'redo']));
  });

  it('checkpoint oversight gates delegate_task: the helper burst gets the one approval there is', () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const ask = (tool: string): boolean => shouldGate({
      tool, isWrite: executor.isWrite(tool), isWide: executor.isWide(tool),
      oversight: 'checkpoint', allowAll: false,
    });
    expect(ask('delegate_task')).toBe(true);
    expect(ask('place_object')).toBe(false); // an ordinary write still rides through checkpoint
  });

  it('describe renders a localized one-liner, never raw JSON', () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const line = executor.describe({ name: 'place_object', args: { catalogId: 'building-myhouse', x: 3, y: 4 } });
    expect(line).not.toContain('{');
    expect(line).not.toContain('building-myhouse');
    expect(line).toContain('(3,4)');
  });

  it('an unknown tool name is reported as an isError result, not a throw', async () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const r = await executor.execute({ callId: 't3', name: 'totally_bogus_tool', args: {} });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('totally_bogus_tool');
  });

  it('wireSchemas({ subagent: true }) excludes the legacy SUBAGENT exclusion list', () => {
    const names = wireSchemas({ subagent: true }).map((s) => s.name);
    expect(names).not.toContain('delegate_task');
    expect(names).not.toContain('update_plan');
    expect(names).not.toContain('suggest_reply');
    expect(names).not.toContain('export_map');
    expect(names).toContain('paint_terrain'); // ordinary tools remain
  });

  it('wireSchemas() (no opts) carries every legacy schema unfiltered', () => {
    const names = wireSchemas().map((s) => s.name).sort();
    expect(names).toEqual(TOOL_SCHEMAS.map((s) => s.name).sort());
  });

  it("delegate_task execution reports 'not wired yet' when no delegate is wired", async () => {
    const { deps } = setup();
    const executor = createExecutor(deps);
    const r = await executor.execute({ callId: 't4', name: 'delegate_task', args: { task: 'x' } });
    expect(r.isError).toBe(true);
    expect(r.content).toBe('Delegation is not wired yet.');
  });
});
