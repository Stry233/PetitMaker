import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { type EditorEvents } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { executeToolCall, type AgentToolDeps } from '../../agent/tools';

function setup(w = 20, h = 20) {
  const state = makeState(w, h);
  const bus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(state, bus, createDefaultRegistry());
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

describe('decorate_zone', () => {
  it('orchard fills the rect with rule-valid plantings in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(
      call('decorate_zone', { x: 4, y: 4, w: 16, h: 16, theme: 'orchard' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/placed/i);
    expect(state.objects.size).toBeGreaterThan(3);         // an orchard grid landed
    expect(exec.getUndoStackSize()).toBe(before + 1);       // ONE stroke group
  });

  it('rejects an unknown theme with the theme list', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('decorate_zone', { x: 0, y: 0, w: 8, h: 8, theme: 'castle' }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('orchard');
  });

  it('farm theme places objects in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(
      call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'farm' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before + 1);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('garden theme places objects in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(
      call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'garden' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before + 1);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('hamlet theme places objects in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(
      call('decorate_zone', { x: 2, y: 2, w: 24, h: 24, theme: 'hamlet' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before + 1);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('same seed reproduces the same result', async () => {
    // First call.
    const { state: s1, deps: d1 } = setup(32, 32);
    await executeToolCall(call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'orchard', seed: 12345 }), d1);
    const ids1 = [...s1.objects.values()].map((o) => `${o.catalogId}:${o.position.x},${o.position.y}`).sort().join('|');

    // Second call with same seed on a fresh state.
    const { state: s2, deps: d2 } = setup(32, 32);
    await executeToolCall(call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'orchard', seed: 12345 }), d2);
    const ids2 = [...s2.objects.values()].map((o) => `${o.catalogId}:${o.position.x},${o.position.y}`).sort().join('|');

    expect(ids1).toBe(ids2);
  });

  it('decorate_zone is in WRITE_TOOLS (approval gate)', async () => {
    const { WRITE_TOOLS } = await import('../../agent/tools');
    expect(WRITE_TOOLS.has('decorate_zone')).toBe(true);
  });

  it('decorate_zone appears in TOOL_SCHEMAS', async () => {
    const { TOOL_SCHEMAS } = await import('../../agent/tools');
    const schema = TOOL_SCHEMAS.find((s) => s.name === 'decorate_zone');
    expect(schema).toBeDefined();
    expect(schema?.inputSchema.properties).toBeDefined();
  });
});

describe('plant_forest', () => {
  it('fills the rect with stands-with-glades ecology in one stroke', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(call('plant_forest', { x: 2, y: 2, w: 20, h: 20, density: 0.8 }), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(5);
    expect(exec.getUndoStackSize()).toBe(before + 1);
  });

  it('is in WRITE_TOOLS and TOOL_SCHEMAS', async () => {
    const { WRITE_TOOLS, TOOL_SCHEMAS } = await import('../../agent/tools');
    expect(WRITE_TOOLS.has('plant_forest')).toBe(true);
    expect(TOOL_SCHEMAS.find((s) => s.name === 'plant_forest')).toBeDefined();
  });
});

describe('build_road_network', () => {
  it('connects existing buildings with roads in one stroke', async () => {
    const { state, deps, exec } = setup(32, 32);
    await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 4, y: 4 }), deps);
    await executeToolCall(call('place_object', { catalogId: 'building-stall', x: 22, y: 22 }), deps);
    const before = exec.getUndoStackSize();
    const r = await executeToolCall(call('build_road_network', {}), deps);
    expect(r.isError).toBe(false);
    expect(exec.getUndoStackSize()).toBe(before + 1);
    const roads = [...state.objects.values()].filter((o) => o.catalogId.startsWith('road-'));
    expect(roads.length).toBeGreaterThan(0);
  });

  it('is in WRITE_TOOLS and TOOL_SCHEMAS', async () => {
    const { WRITE_TOOLS, TOOL_SCHEMAS } = await import('../../agent/tools');
    expect(WRITE_TOOLS.has('build_road_network')).toBe(true);
    expect(TOOL_SCHEMAS.find((s) => s.name === 'build_road_network')).toBeDefined();
  });
});

describe('frame_crossing', () => {
  it('realizes a crossing near (x,y) or reports none gracefully', async () => {
    const { deps } = setup(32, 32);
    const r = await executeToolCall(call('frame_crossing', { x: 16, y: 16 }), deps);
    expect(r.isError).toBe(false); // flat empty map → graceful "no crossing site" text, not a crash
    expect(r.content).toMatch(/no .*(crossing|site)|placed/i);
  });

  it('is in WRITE_TOOLS and TOOL_SCHEMAS', async () => {
    const { WRITE_TOOLS, TOOL_SCHEMAS } = await import('../../agent/tools');
    expect(WRITE_TOOLS.has('frame_crossing')).toBe(true);
    expect(TOOL_SCHEMAS.find((s) => s.name === 'frame_crossing')).toBeDefined();
  });
});
