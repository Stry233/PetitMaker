import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { makeState, makeExecutor } from '../../_support/map-state';
import { executeToolCall, wireSchemas, type AgentToolDeps } from '../../../agent/tools';
import { TOOL_DEFAULTS, defaultRoadId } from '../../../agent/tools/defaults';
import { describeToolArgs } from '../../../agent/tools/describe';
import { translateFor } from '../../../i18n/context';
import type { TextKey } from '../../../i18n/keys';
import { layerNumber } from '../../../core/game/profile';

function setup(w = 30, h = 30) {
  const state = makeState(w, h);
  const exec = makeExecutor(state);
  const deps: AgentToolDeps = { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
  return { state, exec, deps };
}
const en = (k: TextKey, p?: Record<string, string | number>) => translateFor('en', k, p);
const idNames = { catalog: (id: string) => `<${id}>`, object: () => undefined };
const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input });
const schemaText = (tool: string, prop: string): string =>
  String((wireSchemas().find((s) => s.name === tool)!.parameters.properties as Record<string, { description?: string }>)[prop]!.description);

describe('tool defaults', () => {
  it('describes an omitted road id as the road build_road lays', async () => {
    const { state, deps } = setup();
    const input = { x1: 2, y1: 10, x2: 12, y2: 10, smooth: 'off' };
    expect(describeToolArgs({ name: 'build_road', input }, en, idNames)).toContain(`<${defaultRoadId()}>`);
    const r = await executeToolCall(call('build_road', input), deps);
    expect(r.isError, r.content).toBe(false);
    const laid = new Set([...state.objects.values()].map((o) => o.catalogId));
    expect([...laid]).toEqual([defaultRoadId()]);
  });

  it('describes omitted terraform arguments with the values the handlers use', async () => {
    expect(describeToolArgs({ name: 'sculpt_wall', input: { x1: 0, y1: 0, x2: 9, y2: 9 } }, en)).toContain(String(layerNumber(TOOL_DEFAULTS.wallCrest)));
    expect(describeToolArgs({ name: 'sculpt_terrace', input: { cx: 5, cy: 5, baseRadius: 4 } }, en))
      .toBe(describeToolArgs({ name: 'sculpt_terrace', input: { cx: 5, cy: 5, baseRadius: 4, tiers: TOOL_DEFAULTS.terraceTiers } }, en));
    expect(describeToolArgs({ name: 'carve_river', input: { points: [{ x: 1, y: 1 }] } }, en))
      .toBe(describeToolArgs({ name: 'carve_river', input: { points: [{ x: 1, y: 1 }], width: TOOL_DEFAULTS.riverWidth } }, en));
    expect(describeToolArgs({ name: 'undo', input: {} }, en)).toBe(describeToolArgs({ name: 'undo', input: { steps: TOOL_DEFAULTS.historySteps } }, en));

    const terrace = setup();
    const t = await executeToolCall(call('sculpt_terrace', { cx: 15, cy: 15, baseRadius: 8 }), terrace.deps);
    expect(t.isError, t.content).toBe(false);
    const top = Math.max(...terrace.state.cells.flat().map((c) => (c.terrain?.type === TerrainType.Mountain ? c.terrain.elevation : 0)));
    expect(top).toBe(TOOL_DEFAULTS.terraceTiers);

    const wall = setup();
    const w = await executeToolCall(call('sculpt_wall', { x1: 0, y1: 0, x2: 29, y2: 29 }), wall.deps);
    expect(w.isError, w.content).toBe(false);
    const crest = Math.max(...wall.state.cells.flat().map((c) => c.terrain?.elevation ?? 0));
    expect(crest).toBe(TOOL_DEFAULTS.wallCrest);
  });

  it('states each default in the schema text the model reads', () => {
    expect(schemaText('sculpt_terrace', 'tiers')).toContain(`default ${TOOL_DEFAULTS.terraceTiers}`);
    expect(schemaText('sculpt_wall', 'crest')).toContain(`default ${TOOL_DEFAULTS.wallCrest}`);
    expect(schemaText('sculpt_wall', 'depth')).toContain(`default ${TOOL_DEFAULTS.wallDepth}`);
    expect(schemaText('sink_pool', 'elevation')).toContain(`default ${TOOL_DEFAULTS.poolElevation}`);
    expect(schemaText('carve_river', 'width')).toContain(`default ${TOOL_DEFAULTS.riverWidth}`);
    expect(wireSchemas().find((s) => s.name === 'undo')!.description).toContain(`default ${TOOL_DEFAULTS.historySteps}`);
  });
});
