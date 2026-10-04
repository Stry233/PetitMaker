import { describe, expect, it } from 'vitest';
import legacy from '../__fixtures__/ramps-v1.json';
import expected from '../__fixtures__/ramps-v2.json';
import { migrateToCurrent } from '../../../io/save-format';
import { serialize, deserialize } from '../../../io/json-codec';
import { decodeHistory, encodeHistory } from '../../../io/history-codec';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { CommandType, TerrainType, type PlacedObject } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { makeState, setTerrain } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';

describe('two-cell ramp save migration', () => {
  it('preserves the cliff end of every released ramp style without mutating the v1 input', () => {
    const original = JSON.stringify(legacy);
    const migrated = migrateToCurrent(legacy);
    expect(migrated).toEqual(expected);
    expect(JSON.stringify(legacy)).toBe(original);
    expect(migrateToCurrent(migrated)).toEqual(expected);
  });

  it.each([0, 90, 180, 270] as const)('loads rotation %s at its original cliff and round-trips only once', (rotation) => {
    const state = makeState(32, 32);
    for (let y = 10; y <= 21; y++) for (let x = 10; x <= 21; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const old = rotation === 0 ? { x: 14, y: 21 } : rotation === 90 ? { x: 21, y: 14 }
      : rotation === 180 ? { x: 14, y: 6 } : { x: 6, y: 14 };
    const save = JSON.parse(serialize(state));
    save.version = 1;
    save.objects = [{ id: 'ramp', catalogId: 'ramp-teak-stair', ...old, rotation, elevation: 1 }];
    const loaded = deserialize(JSON.stringify(save), state.template);
    const ramp = loaded.objects.get('ramp')!;
    const position = rotation === 180 ? { x: 14, y: 8 } : rotation === 270 ? { x: 8, y: 14 } : old;
    expect(ramp.position).toEqual(position);
    const anchor = rotation === 180 ? { x: 14, y: 10 } : rotation === 270 ? { x: 10, y: 14 } : old;
    const probe = { type: CommandType.PlaceObject as const, timestamp: 0, loadValue: 100,
      object: { ...ramp, position: anchor } };
    expect(createDefaultRegistry().validatePreCommand(probe, state)).toEqual([]);
    expect(probe.object).toEqual(ramp);
    expect(deserialize(serialize(loaded), state.template).objects.get('ramp')).toEqual(ramp);
  });

  it.each([false, true])('restores legacy undo and redo with collapsed=%s', (collapsed) => {
    const old: PlacedObject = { id: 'ramp', catalogId: 'ramp-teak-stair', position: { x: 6, y: 10 }, rotation: 270, elevation: 1 };
    const section = { v: 1, totalSteps: 1, entries: [{
      cmd: { type: CommandType.PlaceObject, timestamp: 0, object: old, loadValue: 100 }, before: [], after: [],
      ...(collapsed ? { objectOps: { added: [old], removed: [] } } : {}),
    }] };
    const original = JSON.stringify(section);
    const entries = decodeHistory(section, { width: 32, height: 32 })!;
    const current = { ...old, position: { x: 8, y: 10 } };
    const state = makeState(32, 32);
    state.objects.set(current.id, current);
    const exec = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));
    exec.restoreHistory(entries);
    exec.undo();
    expect(state.objects.has(current.id)).toBe(false);
    exec.redo();
    expect(state.objects.get(current.id)).toEqual(current);
    expect(decodeHistory(encodeHistory(entries, 'all'))).toEqual(entries);
    expect(JSON.stringify(section)).toBe(original);
  });

  it('reanchors removed ramps as well as the objects in grouped edits', () => {
    const removed: PlacedObject = { id: 'r', catalogId: 'ramp-plank', position: { x: 6.5, y: 6 }, rotation: 180, elevation: 1 };
    const history = { v: 1, totalSteps: 1, entries: [{
      cmd: { type: CommandType.RemoveObject, timestamp: 0, objectId: 'r', removedObject: removed },
      before: [], after: [], objectOps: { added: [], removed: [removed] },
    }] };
    const entries = decodeHistory(history)!;
    const cmd = entries[0]!.cmd;
    expect(cmd.type).toBe(CommandType.RemoveObject);
    if (cmd.type === CommandType.RemoveObject) expect(cmd.removedObject.position).toEqual({ x: 6.5, y: 8 });
    expect(entries[0]!.objectOps!.removed[0]!.position).toEqual({ x: 6.5, y: 8 });
  });
});
