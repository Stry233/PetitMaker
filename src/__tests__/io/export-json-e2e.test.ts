import { describe, it, expect } from 'vitest';
import { serializeWithSections } from '../../io/export-json';
import { deserialize } from '../../io/json-codec';
import { applyOptionalSections } from '../../io/import-sections';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { makeState } from '../rules/_helpers';
import { CommandType, TerrainType, type GenerateConfig } from '../../core/model/types';

/**
 * Full loop: real executor edits → serializeWithSections (every section on) →
 * JSON.parse → deserialize(json, template) → applyOptionalSections over a FRESH
 * executor → undo() reverts the imported edit. Proves the whole spec end to end
 * rather than each half in isolation (export-json.test.ts / import-sections.test.ts /
 * history-codec.test.ts already cover the unit-level behaviour).
 */
describe('export-json e2e: build → export all sections → import → undo', () => {
  it('round-trips cells/objects/notes and restores an undoable history', () => {
    // 1. Build a real edited state via the executor (5 separate PaintTerrain
    //    commands, then commitStroke — matches the CommandExecutor usage pattern
    //    in src/__tests__/io/history-codec.test.ts).
    const state = makeState(16, 16);
    const exec = new CommandExecutor(state, new EventBus(), createDefaultRegistry());
    const startSize = exec.getUndoStackSize();
    for (let i = 0; i < 5; i++) {
      const result = exec.execute({
        type: CommandType.PaintTerrain,
        timestamp: 0,
        cells: [{ x: 2 + i, y: 3 }],
        terrainType: TerrainType.Mountain,
        elevation: 1,
      });
      expect(result.success).toBe(true);
    }
    const violations = exec.commitStroke(startSize);
    expect(violations).toEqual([]);
    // commitStroke folds the whole stroke into ONE undo entry (POLICY: a gesture is
    // one atomic undo step) — the 5 paints collapse to a single history entry.
    expect(exec.getUndoStackSize()).toBe(1);

    state.notes = { title: 'E2E Island', description: 'built by the e2e test', author: 'yue' };
    state.generation = {
      algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed: 123, region: null,
    } as GenerateConfig;

    // 2. Export with EVERY optional section on.
    const entries = exec.getUndoEntries();
    expect(entries.length).toBe(1);
    const json = serializeWithSections(state, {
      notes: state.notes,
      includeGeneration: true,
      includeProvenance: true,
      history: { entries, depth: 'all' },
      session: { v: 1, lockedLayers: [2, 4], camera: { x: 10, y: 20, zoom: 1.5 } },
      includeStats: true,
      includeCatalogInfo: true,
      pretty: false,
    });

    const raw = JSON.parse(json) as Record<string, unknown>;
    expect(raw.generation).toBeDefined();
    expect(raw.history).toBeDefined();
    expect(raw.session).toBeDefined();
    expect(raw.stats).toBeDefined();
    expect(raw.catalogInfo).toBeDefined();
    expect(raw.manifest).toBeDefined();
    expect(raw.provenance).toBeDefined();

    // 3. Plain deserialize (today's loader, ignoring every extra top-level key) —
    //    cells/objects/notes must match the source state exactly.
    const back = deserialize(json, state.template);
    expect(back.notes).toEqual(state.notes);
    expect(back.cells[3]![2]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(back.cells[3]![6]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(back.objects.size).toBe(state.objects.size);
    for (const [id, obj] of state.objects) {
      if (obj.locked) continue; // the plaza is recreated fresh from the template, not round-tripped
      expect(back.objects.get(id)).toEqual(obj);
    }

    // 4. applyOptionalSections over a FRESH executor on the deserialized state —
    //    generation/session/history all restore, and undo() reverts the last edit.
    const freshExec = new CommandExecutor(back, new EventBus(), createDefaultRegistry());
    const locked: number[] = [];
    let camera: { x: number; y: number; zoom: number } | null = null;
    expect(freshExec.canUndo()).toBe(false);

    const result = applyOptionalSections(raw, {
      executor: freshExec,
      state: back,
      setLayerLocked: (layer) => locked.push(layer),
      setCamera: (c) => { camera = c; },
    });

    expect(result.restored.sort()).toEqual(['generation', 'history', 'session']);
    expect(result.dropped).toEqual([]);
    expect(back.generation?.seed).toBe(123);
    expect(locked).toEqual([2, 4]);
    expect(camera).toEqual({ x: 10, y: 20, zoom: 1.5 });

    expect(freshExec.canUndo()).toBe(true);
    freshExec.undo();
    // The stroke collapsed to ONE undo entry (commitStroke's atomic-gesture policy), so a
    // single undo reverts every painted cell, including the last one written (x=6, y=3).
    expect(back.cells[3]![6]!.terrain).toBeNull();
    expect(back.cells[3]![2]!.terrain).toBeNull();
  });

  it('stripping every optional section still loads through plain deserialize', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus(), createDefaultRegistry());
    exec.execute({
      type: CommandType.PaintTerrain,
      timestamp: 0,
      cells: [{ x: 1, y: 1 }],
      terrainType: TerrainType.Mountain,
      elevation: 1,
    });
    exec.commitStroke(0);

    const json = serializeWithSections(state, {
      includeGeneration: false,
      includeProvenance: true,
      includeStats: false,
      includeCatalogInfo: false,
      pretty: false,
    });
    const raw = JSON.parse(json) as Record<string, unknown>;
    expect(raw.generation).toBeUndefined();
    expect(raw.history).toBeUndefined();
    expect(raw.session).toBeUndefined();
    expect(raw.stats).toBeUndefined();
    expect(raw.catalogInfo).toBeUndefined();
    expect(raw.manifest).toBeDefined(); // always-on

    expect(() => deserialize(json, state.template)).not.toThrow();
    const back = deserialize(json, state.template);
    expect(back.cells[1]![1]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
});
