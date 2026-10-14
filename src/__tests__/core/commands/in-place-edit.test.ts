import { describe, it, expect } from 'vitest';
import { CommandType, type Corners, type PlacedObject, type TrimRoadCommand } from '../../../core/model/types';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import { makeState, makeExecutor } from '../../_support/map-state';
import { bareExecutor } from '../../_support/kernel';
import { EventBus } from '../../../core/commands/event-bus';
import type { KernelEvents } from '../../../core/commands/events';

const ROAD = 'path-overgrown-dirt';

function placeRoad(ex: CommandExecutor, x: number, y: number, extra: Partial<PlacedObject> = {}): PlacedObject {
  const obj: PlacedObject = { id: `r-${x}-${y}`, catalogId: ROAD, position: { x, y }, rotation: 0, elevation: 0, ...extra };
  expect(ex.execute({ type: CommandType.PlaceObject, object: obj }).success).toBe(true);
  return obj;
}
const trim = (obj: PlacedObject, afterCorners: Corners, extra: Partial<TrimRoadCommand> = {}): TrimRoadCommand => ({
  type: CommandType.TrimCorners, x: obj.position.x, y: obj.position.y, layer: 'road', objectId: obj.id, afterCorners, ...extra,
});

describe('an object edited in place', () => {
  it('records the object before and after the edit as its history entry object ops', () => {
    const state = makeState(10, 10);
    const ex = makeExecutor(state);
    const road = placeRoad(ex, 3, 3);
    const before = structuredClone(state.objects.get(road.id)!);
    const after: Corners = ['fan', 'square', 'square', 'square'];
    expect(ex.execute(trim(road, after, { afterRotation: 90 })).success).toBe(true);
    const entry = ex.getUndoEntries().at(-1)!;
    expect(entry.objectOps).toEqual({ removed: [before], added: [{ ...before, corners: after, rotation: 90 }] });
  });

  it('keeps the recorded copies apart from the map, so a later edit leaves the entry as it was', () => {
    const state = makeState(10, 10);
    const ex = makeExecutor(state);
    const road = placeRoad(ex, 3, 3);
    ex.execute(trim(road, ['fan', 'square', 'square', 'square']));
    const entry = ex.getUndoEntries().at(-1)!;
    state.objects.get(road.id)!.rotation = 180;
    expect(entry.objectOps!.added[0]!.rotation).toBe(0);
  });

  it('undoes a collapsed group of edits to the object as it stood, every field included', () => {
    const state = makeState(10, 10);
    const ex = makeExecutor(state);
    const road = placeRoad(ex, 4, 4, { patchOnly: false });
    const original = structuredClone(state.objects.get(road.id)!);
    const stroke = ex.beginStroke();
    const half: Corners = ['empty', 'empty', 'square', 'square'];
    ex.execute(trim(road, half));
    ex.execute(trim(road, ['fan', 'empty', 'square', 'square'], { afterRotation: 270 }));
    stroke.commit({ reconcile: false });
    const edited = structuredClone(state.objects.get(road.id)!);

    ex.undo();
    expect(state.objects.get(road.id)).toEqual(original);
    ex.redo();
    expect(state.objects.get(road.id)).toEqual(edited);
  });

  it('announces the edit, its undo and its redo each as one removal and addition of the object', () => {
    const state = makeState(10, 10);
    const bus = new EventBus<KernelEvents>();
    const ex = bareExecutor(state, { bus });
    const road = placeRoad(ex, 2, 2);
    const seen: KernelEvents['objects-changed'][] = [];
    bus.on('objects-changed', (e) => seen.push(e));
    ex.execute(trim(road, ['fan', 'square', 'square', 'square']));
    ex.undo();
    ex.redo();
    expect(seen.map((e) => [e.removed, e.added?.map((o) => o.id)])).toEqual([
      [[road.id], [road.id]], [[road.id], [road.id]], [[road.id], [road.id]],
    ]);
  });
});
