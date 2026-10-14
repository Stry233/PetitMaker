import { describe, it, expect } from 'vitest';
import { CommandType, type Corners, type PlacedObject, type TrimCornersCommand } from '../../../core/model/types';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { RuleRegistry } from '../../../rules/registry';
import { makeState, makeExecutor } from '../../_support/map-state';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';
import { createExecutor } from '../../../state/executor';

const ROAD = 'path-overgrown-dirt';
const EMPTY: Corners = ['empty', 'empty', 'empty', 'empty'];

function placeRoad(ex: CommandExecutor, x: number, y: number, extra: Partial<PlacedObject> = {}): PlacedObject {
  const obj: PlacedObject = { id: `r-${x}-${y}`, catalogId: ROAD, position: { x, y }, rotation: 0, elevation: 0, ...extra };
  expect(ex.execute({ type: CommandType.PlaceObject, object: obj }).success).toBe(true);
  return obj;
}
const trim = (obj: PlacedObject, afterCorners: Corners): TrimCornersCommand => ({
  type: CommandType.TrimCorners, x: obj.position.x, y: obj.position.y, layer: 'road', objectId: obj.id, afterCorners,
});

describe('road corner trim to all-empty', () => {
  it('removes the road, undo restores it with its id and corners, redo removes it again', () => {
    const state = makeState(10, 10);
    const ex = makeExecutor(state);
    const prior: Corners = ['fan', 'square', 'tri-NE', 'square'];
    const road = placeRoad(ex, 3, 3, { corners: prior, rotation: 90 });
    const snapshot = structuredClone(state.objects.get(road.id));

    expect(ex.execute(trim(road, EMPTY)).success).toBe(true);
    expect(state.objects.has(road.id)).toBe(false);

    ex.undo();
    expect(state.objects.get(road.id)).toEqual(snapshot);

    ex.redo();
    expect(state.objects.has(road.id)).toBe(false);
    ex.undo();
    expect(state.objects.get(road.id)).toEqual(snapshot);
  });

  it('a collapsed stroke that trims a road and then empties it undoes to the pre-stroke road', () => {
    const state = makeState(10, 10);
    const ex = makeExecutor(state);
    const road = placeRoad(ex, 4, 4);
    const start = ex.beginStroke();
    const half: Corners = ['empty', 'empty', 'square', 'square'];
    ex.execute(trim(road, half));
    ex.execute(trim(road, EMPTY));
    start.commit({ reconcile: false });
    expect(start.size).toBe(1);
    expect(state.objects.has(road.id)).toBe(false);

    ex.undo();
    const back = state.objects.get(road.id)!;
    expect(back).toBeDefined();
    expect(back.corners).toBeUndefined();
    expect(back.rotation).toBe(0);

    ex.redo();
    expect(state.objects.has(road.id)).toBe(false);
  });

  it('a trim that runs after the road was already emptied away does not bring it back on redo', () => {
    const state = makeState(10, 10);
    const ex = createExecutor(state, new RuleRegistry());
    const road = placeRoad(ex, 4, 4);
    const start = ex.beginStroke();
    ex.execute(trim(road, EMPTY));
    ex.execute(trim(road, ['fan', 'square', 'square', 'square']));
    start.commit({ reconcile: false });
    expect(state.objects.has(road.id)).toBe(false);

    ex.undo();
    expect(state.objects.get(road.id)?.corners).toBeUndefined();
    ex.redo();
    expect(state.objects.has(road.id)).toBe(false);
  });

  it('the agent trim_corner tool can empty a road and undo brings it back', async () => {
    const state = makeState(10, 10);
    const ex = makeExecutor(state);
    const road = placeRoad(ex, 5, 5);
    const deps: AgentToolDeps = { getState: () => state, getExecutor: () => ex, getRegion: () => [] };
    for (const corner of ['TL', 'TR', 'BL', 'BR']) {
      const r = await executeToolCall({ id: 't', name: 'trim_corner', input: { x: 5, y: 5, corner, layer: 'road', style: 'empty' } }, deps);
      expect(r.isError, r.content).toBe(false);
    }
    expect(state.objects.has(road.id)).toBe(false);

    ex.undo();
    expect(state.objects.get(road.id)?.corners).toEqual(['empty', 'empty', 'empty', 'square']);
    ex.redo();
    expect(state.objects.has(road.id)).toBe(false);
  });
});
