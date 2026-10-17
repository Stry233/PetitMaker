import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { doorGroundRule } from '../../../rules/door-ground';
import { zoneRestrictionRule } from '../../../rules/zone-restriction';
import { TerrainType, type GridState, type MacroCoord, type Rotation } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { placeObjectCommand } from '../../../core/model/command-build';
import { type EditorEvents } from '../../../state/editing/events';
import { createExecutor } from '../../../state/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { makeState, setTerrain, setZone } from '../../_support/map-state';

const HOUSE = 'building-forest-cabin';

function deps(state: GridState): AgentToolDeps {
  const exec = createExecutor(state, createDefaultRegistry(), new EventBus<EditorEvents>());
  return { getState: () => state, getExecutor: () => exec, getRegion: () => [] };
}

async function anchors(state: GridState, input: Record<string, unknown>): Promise<MacroCoord[]> {
  const r = await executeToolCall({ id: 't', name: 'find_flat_areas', input }, deps(state));
  expect(r.isError, r.content).toBe(false);
  const listed = r.content.split('Nearest')[1] ?? '';
  return [...listed.matchAll(/\((\d+),(\d+)\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

const place = (catalogId: string, at: MacroCoord, rotation: Rotation, elevation: number) =>
  placeObjectCommand({ id: 'probe', catalogId, position: at, rotation, elevation });

describe('find_flat_areas for an item', () => {
  it('offers sand to an item whose ground zones allow it, and grass alone to the rest', async () => {
    const state = makeState(30, 30);
    for (let y = 10; y < 30; y++) for (let x = 0; x < 30; x++) setZone(state, x, y, CellZone.Beach);
    const sandy = await anchors(state, { catalogId: HOUSE, nearX: 10, nearY: 22, limit: 3 });
    expect(sandy.length).toBeGreaterThan(0);
    expect(sandy.some((a) => a.y >= 10)).toBe(true);
    for (const a of sandy) expect(zoneRestrictionRule.validate(place(HOUSE, a, 0, 0), state), `${a.x},${a.y}`).toEqual([]);
    const grassOnly = await anchors(state, { minWidth: 5, minHeight: 4, nearX: 10, nearY: 22, limit: 3 });
    for (const a of grassOnly) expect(a.y + 4).toBeLessThanOrEqual(10);
  });

  it.each([0, 90, 180, 270] as const)('returns only anchors whose door side the rule accepts, turned %i degrees', async (rotation) => {
    // A plateau at layer 1 with a cliff all round, 8 cells in from the map edge.
    const state = makeState(40, 40);
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const found = await anchors(state, { catalogId: HOUSE, rotation, elevation: 1, nearX: 8, nearY: 8, limit: 10 });
    expect(found.length).toBeGreaterThan(0);
    for (const a of found) expect(doorGroundRule.validate(place(HOUSE, a, rotation, 1), state), `${a.x},${a.y}`).toEqual([]);
  });

  it('a bare footprint search knows nothing of doors, which is why the item search exists', async () => {
    const state = makeState(40, 40);
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const bare = await anchors(state, { minWidth: 5, minHeight: 4, elevation: 1, nearX: 8, nearY: 31, limit: 10 });
    expect(bare.some((a) => doorGroundRule.validate(place(HOUSE, a, 0, 1), state).length > 0)).toBe(true);
  });
});
