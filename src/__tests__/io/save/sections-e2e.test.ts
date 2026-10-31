import { describe, it, expect } from 'vitest';
import { carrying, serializeWithSections } from '../../../io/save/sections';
import type { PersistedCamera } from '../../../io/save/format';
import { deserialize } from '../../_support/save-file';
import { applyOptionalSections } from '../../../io/import/sections-restore';
import { makeState, makeExecutor } from '../../_support/map-state';
import { CommandType, TerrainType } from '../../../core/model/types';
import { defaultConfig } from '../../../tools/generation/recipe';
import { exportable } from '../../_support/exportable';

/**
 * Full loop: real executor edits, serializeWithSections (every section on), JSON.parse,
 * deserialize(json, template), applyOptionalSections over a fresh executor, then undo() reverts
 * the imported edit. The unit-level halves are covered by sections.test.ts, sections-restore.test.ts
 * and history-codec.test.ts.
 */
describe('sectioned save e2e: build → export all sections → import → undo', () => {
  it('round-trips cells/objects/notes and restores an undoable history', () => {
    // Five PaintTerrain commands, then commitStroke.
    const state = makeState(16, 16);
    const exec = makeExecutor(state);
    const startSize = exec.beginStroke();
    for (let i = 0; i < 5; i++) {
      const result = exec.execute({
        type: CommandType.PaintTerrain,
        cells: [{ x: 2 + i, y: 3 }],
        terrainType: TerrainType.Mountain,
        elevation: 1,
      });
      expect(result.success).toBe(true);
    }
    const violations = startSize.commit();
    expect(violations).toEqual([]);
    // commitStroke folds the five paints into one undo entry: a gesture is one atomic undo step.
    expect(exec.historyDepth()).toBe(1);

    state.notes = { title: 'E2E Island', description: 'built by the e2e test' };
    state.generation = defaultConfig('designed', { maxElevation: 8, seed: 123 });

    const entries = exec.getUndoEntries();
    expect(entries.length).toBe(1);
    const json = serializeWithSections(exportable(state), {
      carry: carrying('annotations', 'notes', 'generation', 'provenance', 'history', 'session', 'stats', 'catalog'),
      notes: state.notes,
      history: { entries, depth: 'all' },
      session: { lockedLayers: [2, 4], camera: { view2d: { x: 10, y: 20, zoom: 1.5 }, view3d: { az: 15, el: 35, dist: 1.2 } } },
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

    // A plain deserialize ignores every extra top-level key; cells, objects and notes match the source.
    const back = deserialize(json, state.template);
    expect(back.notes).toEqual(state.notes);
    expect(back.cells[3]![2]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(back.cells[3]![6]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(back.objects.size).toBe(state.objects.size);
    for (const [id, obj] of state.objects) {
      if (obj.locked) continue; // the plaza is recreated fresh from the template, not round-tripped
      expect(back.objects.get(id)).toEqual(obj);
    }

    // applyOptionalSections restores generation, session and history on a fresh executor.
    const freshExec = makeExecutor(back);
    const locked: number[] = [];
    let camera: PersistedCamera | null = null;
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
    expect(camera).toEqual({ view2d: { x: 10, y: 20, zoom: 1.5 }, view3d: { az: 15, el: 35, dist: 1.2 } });
    expect(raw.session).toEqual({ v: 1, lockedLayers: [2, 4] });

    expect(freshExec.canUndo()).toBe(true);
    freshExec.undo();
    // The stroke is one undo entry, so a single undo reverts every painted cell, including the last (x=6, y=3).
    expect(back.cells[3]![6]!.terrain).toBeNull();
    expect(back.cells[3]![2]!.terrain).toBeNull();
  });

  it('stripping every optional section still loads through plain deserialize', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    exec.execute({
      type: CommandType.PaintTerrain,
      cells: [{ x: 1, y: 1 }],
      terrainType: TerrainType.Mountain,
      elevation: 1,
    });
    whole.commit();

    const json = serializeWithSections(exportable(state), {
      carry: carrying('annotations', 'notes', 'provenance'),
      pretty: false,
    });
    const raw = JSON.parse(json) as Record<string, unknown>;
    expect(raw.generation).toBeUndefined();
    expect(raw.history).toBeUndefined();
    expect(raw.session).toBeUndefined();
    expect(raw.stats).toBeUndefined();
    expect(raw.catalogInfo).toBeUndefined();
    expect(raw.manifest).toBeDefined(); // always written

    expect(() => deserialize(json, state.template)).not.toThrow();
    const back = deserialize(json, state.template);
    expect(back.cells[1]![1]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
});
