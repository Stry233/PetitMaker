/** What the assistant sees when it looks at its work: the map as built, and the ground alone by level. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { TerrainType } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { makeState, setTerrain } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';
import { detectWaterfalls } from '../../../core/domain/terrain/waterfall-geometry';
import { takeGroundSnapshot } from '../../../agent/exec/snapshot';

type SnapshotOptions = Parameters<NonNullable<AgentToolDeps['snapshot']>>[0];

function world(vision: boolean) {
  const state = makeState(40, 40);
  const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
  const asked: (SnapshotOptions | undefined)[] = [];
  const deps: AgentToolDeps = {
    getState: () => state, getExecutor: () => exec, getRegion: () => [],
    ...(vision ? {
      snapshot: async (opts?: SnapshotOptions) => { asked.push(opts); return 'data:image/png;base64,'; },
      snapshotGround: (rect?: { x1: number; y1: number; x2: number; y2: number }) => takeGroundSnapshot(state, rect),
    } : {}),
  };
  return { state, deps, asked };
}
const call = (name: string, input: Record<string, unknown>) => ({ id: 't', name, input });
const terrace = (w: ReturnType<typeof world>): void => {
  for (let y = 2; y < 38; y++) for (let x = 2; x < 18; x++) setTerrain(w.state, x, y, TerrainType.Mountain, 3);
};

describe('the map the assistant looks at', () => {
  spec('ASST-39', 'is the map as built, its plan drawn over it only when the plan is asked for', async () => {
    const w = world(true);
    await executeToolCall(call('view_map', {}), w.deps);
    await executeToolCall(call('view_map', { layer: 'plan' }), w.deps);
    expect(w.asked.map((o) => o?.notes)).toEqual([false, true]);
  });

  spec('ASST-39', 'shows the ground alone, each level and every waterfall counted', async () => {
    const w = world(true);
    terrace(w);
    expect((await executeToolCall(call('carve_river', { points: [{ x: 8, y: 20 }, { x: 30, y: 20 }], width: 3 }), w.deps)).isError).toBe(false);
    const r = await executeToolCall(call('view_map', { layer: 'ground' }), w.deps);
    expect(r.isError).toBe(false);
    expect(r.image?.dataUrl.startsWith('data:image/png;base64,iVBOR')).toBe(true);
    expect(r.content).toContain(`waterfall pieces ${detectWaterfalls(w.state).length}`);
    expect(r.content).toMatch(/pieces of ground by land level .*3:\d+/);
  });

  spec('ASST-39', 'tells a reader of the rendered map what the ground holds and where to see it', async () => {
    const w = world(true);
    terrace(w);
    const r = await executeToolCall(call('view_map', {}), w.deps);
    expect(r.content).toMatch(/Ground here: pieces of ground by land level .*3:\d+/);
    expect(r.content).toContain('layer "ground"');
  });

  spec('ASST-39', 'tells a connection without pictures where the exact levels are', async () => {
    const r = await executeToolCall(call('view_map', { layer: 'ground', x1: 0, y1: 0, x2: 9, y2: 9 }), world(false).deps);
    expect(r.image).toBeUndefined();
    expect(r.content).toContain('inspect_region');
  });
});
