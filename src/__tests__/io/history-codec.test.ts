import { describe, it, expect } from 'vitest';
import { encodeHistory, decodeHistory, HISTORY_SCHEMA_VERSION } from '../../io/history-codec';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { makeState } from '../rules/_helpers';
import { CommandType, TerrainType, type PlaceObjectCommand } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';

function editedExecutor() {
  const state = makeState(12, 12);
  const exec = new CommandExecutor(state, new EventBus(), createDefaultRegistry());
  // Execute 5 commands WITHOUT commitStroke so they remain as separate undo entries
  for (let i = 0; i < 5; i++) {
    exec.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 2 + i, y: 3 }], terrainType: TerrainType.Mountain, elevation: 1 });
  }
  // DO NOT call commitStroke — keep entries uncollapsed for testing the codec
  return { state, exec };
}

describe('history codec', () => {
  it('encodes the undo stack and JSON round-trips it', () => {
    const { exec } = editedExecutor();
    const entries = exec.getUndoEntries();
    expect(entries.length).toBeGreaterThanOrEqual(5);
    const section = encodeHistory(entries, 'all');
    expect(section.v).toBe(HISTORY_SCHEMA_VERSION);
    expect(section.totalSteps).toBe(entries.length);
    const back = decodeHistory(JSON.parse(JSON.stringify(section)));
    expect(back).not.toBeNull();
    expect(back!.length).toBe(entries.length);
  });
  it('depth N keeps only the most recent N steps', () => {
    const { exec } = editedExecutor();
    const section = encodeHistory(exec.getUndoEntries(), 2);
    expect(section.entries.length).toBe(2);
    expect(section.totalSteps).toBeGreaterThanOrEqual(5);
  });
  it('restoreHistory seeds a FRESH executor so undo reverts the imported edits', () => {
    const { state, exec } = editedExecutor();
    const entries = decodeHistory(JSON.parse(JSON.stringify(encodeHistory(exec.getUndoEntries(), 'all'))))!;
    // Fresh executor over the same (already edited) state — like after an import.
    const fresh = new CommandExecutor(state, new EventBus(), createDefaultRegistry());
    expect(fresh.canUndo()).toBe(false);
    fresh.restoreHistory(entries);
    expect(fresh.canUndo()).toBe(true);
    fresh.undo();
    expect(state.cells[3]![6]!.terrain).toBeNull(); // last SetTerrain reverted
    expect(state.cells[3]![2]!.terrain).not.toBeNull(); // earlier ones intact
  });
  it('decodeHistory fails safe on wrong version / malformed input', () => {
    const { exec } = editedExecutor();
    const good = encodeHistory(exec.getUndoEntries(), 'all');
    expect(decodeHistory({ ...good, v: 99 })).toBeNull();
    expect(decodeHistory(null)).toBeNull();
    expect(decodeHistory({ v: 1, totalSteps: 1, entries: [{ nope: true }] })).toBeNull();
  });

  it('collapsed-entry round-trip: place object → commitStrokeGroup → encode → decode → restore → undo removes it', () => {
    const { state: originalState, exec: originalExec } = editedExecutor();

    // Place an object and collapse it into a single undo entry via commitStrokeGroup
    const startSize = originalExec.getUndoStackSize();
    const obj = {
      id: 'test-obj-1', catalogId: 'road-dirt',
      position: { x: 5, y: 5 }, rotation: 0, elevation: 0,
    };
    const item = getCatalogItem('road-dirt');
    const placeResult = originalExec.execute({
      type: CommandType.PlaceObject, timestamp: 0,
      object: obj, loadValue: item?.loadValue ?? 0,
    } as PlaceObjectCommand);
    expect(placeResult.success).toBe(true);
    expect(originalState.objects.has(obj.id)).toBe(true);

    // Collapse into one entry
    originalExec.commitStrokeGroup(startSize);
    expect(originalExec.getUndoStackSize()).toBe(startSize + 1); // collapsed to one

    // Encode all undo entries, JSON round-trip, and decode
    const entries = originalExec.getUndoEntries();
    const section = encodeHistory(entries, 'all');
    const decoded = decodeHistory(JSON.parse(JSON.stringify(section)));
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBe(entries.length);

    // Create a FRESH executor over the same (already edited) state and restore history
    const freshExec = new CommandExecutor(originalState, new EventBus(), createDefaultRegistry());
    expect(freshExec.canUndo()).toBe(false); // fresh executor has no history yet

    freshExec.restoreHistory(decoded!);
    expect(freshExec.canUndo()).toBe(true);

    // ONE undo should remove the placed object (the collapsed entry reverts everything)
    freshExec.undo();
    expect(originalState.objects.has(obj.id)).toBe(false); // object removed
  });

  it('decodeHistory rejects objectOps with non-array removed or added', () => {
    const malformed = {
      v: HISTORY_SCHEMA_VERSION,
      totalSteps: 1,
      entries: [{
        cmd: { type: CommandType.PaintTerrain, timestamp: 0, cells: [], terrainType: TerrainType.Mountain, elevation: 1 },
        before: [],
        after: [],
        objectOps: { added: 'nope' }, // should be an array
      }],
    };
    expect(decodeHistory(malformed)).toBeNull();
  });

  it('decodeHistory rejects objectOps that is not an object', () => {
    const malformed = {
      v: HISTORY_SCHEMA_VERSION,
      totalSteps: 1,
      entries: [{
        cmd: { type: CommandType.PaintTerrain, timestamp: 0, cells: [], terrainType: TerrainType.Mountain, elevation: 1 },
        before: [],
        after: [],
        objectOps: null, // should be an object with arrays
      }],
    };
    expect(decodeHistory(malformed)).toBeNull();
  });
});
