import { describe, it, expect } from 'vitest';
import { CommandType, type Corners, type EditorEvents, type PlacedObject, type TrimCornersCommand } from '../../../core/model/types';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { RuleRegistry } from '../../../rules/registry';
import { roadLookup } from '../../../state/object-index';
import { encodeHistory } from '../../../io/history-codec';
import { makeState } from '../../rules/_helpers';

const HALF: Corners = ['fan', 'square', 'square', 'square'];
const MORE: Corners = ['fan', 'fan', 'square', 'square'];

function setup() {
  const state = makeState(10, 10);
  const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), new RuleRegistry(), roadLookup(state));
  return { state, ex };
}
const road = (id = 'road', x = 4): PlacedObject => ({ id, catalogId: 'path-overgrown-dirt', position: { x, y: 4 }, rotation: 0, elevation: 0 });
const trim = (beforeCorners: Corners | undefined, afterCorners: Corners, rotation?: { before: 0 | 90; after: 0 | 90 }): TrimCornersCommand => ({
  type: CommandType.TrimCorners, timestamp: 0, x: 4, y: 4, layer: 'road', objectId: 'road', beforeCorners, afterCorners,
  ...(rotation ? { beforeRotation: rotation.before, afterRotation: rotation.after } : {}),
});
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('history entries keep the state they recorded', () => {
  it.each([false, true])('redo of a placement restores the road as placed after later trims and rotations were undone, grouped=%s', (grouped) => {
    const { state, ex } = setup();
    const start = ex.getUndoStackSize();
    expect(ex.execute({ type: CommandType.PlaceObject, timestamp: 0, object: road() }).success).toBe(true);
    if (grouped) {
      ex.execute({ type: CommandType.PlaceObject, timestamp: 0, object: road('other', 7) });
      ex.commitStroke(start, { reconcile: false });
    }
    const asPlaced = structuredClone(state.objects.get('road'));

    expect(ex.execute(trim(undefined, HALF)).success).toBe(true);
    expect(ex.execute(trim(HALF, MORE, { before: 0, after: 90 })).success).toBe(true);
    expect(state.objects.get('road')).toMatchObject({ corners: MORE, rotation: 90 });

    const placeEntry = plain(encodeHistory(ex.getUndoEntries(), 'all')).entries[start]!;
    const recorded = placeEntry.objectOps?.added.find((o) => o.id === 'road')
      ?? (placeEntry.cmd.type === CommandType.PlaceObject ? placeEntry.cmd.object : undefined);
    expect(recorded).toEqual(plain(asPlaced));

    ex.undo();
    ex.undo();
    ex.undo();
    expect(state.objects.has('road')).toBe(false);
    ex.redo();
    expect(state.objects.get('road')).toEqual(asPlaced);
    ex.redo();
    expect(state.objects.get('road')).toMatchObject({ corners: HALF, rotation: 0 });
    ex.redo();
    expect(state.objects.get('road')).toMatchObject({ corners: MORE, rotation: 90 });
  });

  it('a removal undone and then trimmed redoes the trim over the restored road, leaving the earlier entries intact', () => {
    const { state, ex } = setup();
    ex.execute({ type: CommandType.PlaceObject, timestamp: 0, object: road() });
    ex.execute(trim(undefined, HALF));
    ex.execute({ type: CommandType.RemoveObject, timestamp: 0, objectId: 'road', removedObject: state.objects.get('road')! });
    ex.undo();
    ex.execute(trim(HALF, MORE));
    ex.undo();
    expect(state.objects.get('road')?.corners).toEqual(HALF);
    ex.undo();
    expect(state.objects.get('road')?.corners).toBeUndefined();
    ex.undo();
    expect(state.objects.has('road')).toBe(false);
    ex.redo();
    expect(state.objects.get('road')).toEqual(road());
  });
});
