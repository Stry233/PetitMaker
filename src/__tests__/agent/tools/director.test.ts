import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { ItemCategory } from '../../../config/catalog/categories';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { categoryOf } from '../../../state/catalog';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { createExecutor } from '../../../state/executor';

function setup(w = 20, h = 20) {
  const state = makeState(w, h);
  const bus = new EventBus<EditorEvents>();
  const exec = createExecutor(state, createDefaultRegistry(), bus);
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });

describe('decorate_zone', () => {
  it('orchard fills the rect with rule-valid plantings in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.historyDepth();
    const r = await executeToolCall(
      call('decorate_zone', { x: 4, y: 4, w: 16, h: 16, theme: 'orchard' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/placed/i);
    expect(state.objects.size).toBeGreaterThan(3);         // an orchard grid landed
    expect(exec.historyDepth()).toBe(before + 1);       // One stroke group
  });

  it('rejects an unknown theme with the theme list', async () => {
    const { deps } = setup();
    const r = await executeToolCall(call('decorate_zone', { x: 0, y: 0, w: 8, h: 8, theme: 'castle' }), deps);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('orchard');
  });

  it('farm theme places objects in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.historyDepth();
    const r = await executeToolCall(
      call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'farm' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('garden theme places objects in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.historyDepth();
    const r = await executeToolCall(
      call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'garden' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('hamlet theme places objects in one undo step', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.historyDepth();
    const r = await executeToolCall(
      call('decorate_zone', { x: 2, y: 2, w: 24, h: 24, theme: 'hamlet' }),
      deps,
    );
    expect(r.isError).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
    expect(state.objects.size).toBeGreaterThan(0);
  });

  it('same seed reproduces the same result', async () => {
    const { state: s1, deps: d1 } = setup(32, 32);
    await executeToolCall(call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'orchard', seed: 12345 }), d1);
    const ids1 = [...s1.objects.values()].map((o) => `${o.catalogId}:${o.position.x},${o.position.y}`).sort().join('|');

    const { state: s2, deps: d2 } = setup(32, 32);
    await executeToolCall(call('decorate_zone', { x: 2, y: 2, w: 20, h: 20, theme: 'orchard', seed: 12345 }), d2);
    const ids2 = [...s2.objects.values()].map((o) => `${o.catalogId}:${o.position.x},${o.position.y}`).sort().join('|');

    expect(ids1).toBe(ids2);
  });

  it('decorate_zone writes the map (approval gate)', async () => {
    const { TOOL_FACTS } = await import('../../../agent/tools');
    expect(TOOL_FACTS.access('decorate_zone')).not.toBe('read');
  });

  it('decorate_zone appears in the wire schemas', async () => {
    const { wireSchemas } = await import('../../../agent/tools');
    const schema = wireSchemas().find((s) => s.name === 'decorate_zone');
    expect(schema).toBeDefined();
    expect(schema?.parameters.properties).toBeDefined();
  });
});

describe('plant_forest', () => {
  it('fills the rect with stands-with-glades ecology in one stroke', async () => {
    const { state, deps, exec } = setup(32, 32);
    const before = exec.historyDepth();
    const r = await executeToolCall(call('plant_forest', { x: 2, y: 2, w: 20, h: 20, density: 0.8 }), deps);
    expect(r.isError).toBe(false);
    expect(state.objects.size).toBeGreaterThan(5);
    expect(exec.historyDepth()).toBe(before + 1);
  });

  it('writes the map and is in the wire schemas', async () => {
    const { TOOL_FACTS, wireSchemas } = await import('../../../agent/tools');
    expect(TOOL_FACTS.access('plant_forest')).not.toBe('read');
    expect(wireSchemas().find((s) => s.name === 'plant_forest')).toBeDefined();
  });
});

describe('build_road_network', () => {
  it('connects existing buildings with roads in one stroke', async () => {
    const { state, deps, exec } = setup(32, 32);
    await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 4, y: 4 }), deps);
    await executeToolCall(call('place_object', { catalogId: 'building-stall', x: 22, y: 22 }), deps);
    const before = exec.historyDepth();
    const r = await executeToolCall(call('build_road_network', {}), deps);
    expect(r.isError).toBe(false);
    expect(exec.historyDepth()).toBe(before + 1);
    const roads = [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
    expect(roads.length).toBeGreaterThan(0);
    // The count names the two buildings, not the road tiles the run just laid beside them.
    expect(r.content).toContain('connecting 2 buildings');
  });

  it('climbs a ramp onto a plaza standing on layer-1 ground', async () => {
    const state = createGridState(getMapTemplate('hexia'));
    const exec = createExecutor(state, createDefaultRegistry());
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
    const placed = await executeToolCall(call('place_object', { catalogId: 'building-myhouse', x: 60, y: 40 }), deps);
    expect(placed.isError, placed.content).toBe(false);
    const r = await executeToolCall(call('build_road_network', {}), deps);
    expect(r.isError, r.content).toBe(false);
    const ramps = [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Ramp);
    expect(ramps.length).toBeGreaterThan(0);
  });

  it('writes the map and is in the wire schemas', async () => {
    const { TOOL_FACTS, wireSchemas } = await import('../../../agent/tools');
    expect(TOOL_FACTS.access('build_road_network')).not.toBe('read');
    expect(wireSchemas().find((s) => s.name === 'build_road_network')).toBeDefined();
  });
});

describe('frame_crossing', () => {
  it('realizes a crossing near (x,y) or reports none gracefully', async () => {
    const { deps } = setup(32, 32);
    const r = await executeToolCall(call('frame_crossing', { x: 16, y: 16 }), deps);
    expect(r.isError).toBe(false); // flat empty map → graceful "no crossing site" text, not a crash
    expect(r.content).toMatch(/no .*(crossing|site)|placed/i);
  });

  it('writes the map and is in the wire schemas', async () => {
    const { TOOL_FACTS, wireSchemas } = await import('../../../agent/tools');
    expect(TOOL_FACTS.access('frame_crossing')).not.toBe('read');
    expect(wireSchemas().find((s) => s.name === 'frame_crossing')).toBeDefined();
  });
});
