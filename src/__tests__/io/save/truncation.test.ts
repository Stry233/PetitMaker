import { describe, expect, it, vi } from 'vitest';
import { serialize, decodeSave } from '../../../io/save/json-codec';
import { parseSave } from '../../../io/save/parse';
import { carrying, serializeWithSections } from '../../../io/save/sections';
import { importFile } from '../../../io/import/file';
import { migrateToCurrent, CURRENT_VERSION } from '../../../io/save/format';
import { ImportError } from '../../../io/save/import-error';
import { DEFAULT_MAP } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { TerrainType, type GridState } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import legacyV1 from '../../fixtures/saves/legacy-v1-no-provenance.json';
import { makeExecutor, paintCmd } from '../../_support/map-state';
import { exportable } from '../../_support/exportable';

vi.setConfig({ testTimeout: 30_000 });

/** A built-in map with three mountain runs, so its cell list has several runs and tokens. */
function workingMap(): GridState {
  const state = createGridState(DEFAULT_MAP);
  let painted = 0;
  for (let y = 0; y < DEFAULT_MAP.height && painted < 30; y++) {
    for (let x = 0; x < DEFAULT_MAP.width && painted < 30; x++) {
      if (DEFAULT_MAP.zones[y]?.[x] !== CellZone.Grass) continue;
      state.cells[y]![x] = { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1 + (painted % 3) } };
      painted++;
    }
  }
  return state;
}

function read(raw: unknown) {
  return decodeSave(parseSave(raw));
}

describe('a truncated save never loads as a different map', () => {
  it('rejects every cut of the cell list that drops a run or a run count', () => {
    const save = JSON.parse(serialize(workingMap())) as { cells: string };
    const cells = save.cells;
    // Cutting at a run boundary or inside a run count changes the cell total, which the
    // decoder checks against the template area.
    const cuts = new Set<number>();
    for (let i = 1; i < cells.length; i++) if (cells[i] === ',' || cells[i] === '*') cuts.add(i);
    expect(cuts.size).toBeGreaterThan(6);
    for (const cut of cuts) {
      expect(() => read({ ...save, cells: cells.slice(0, cut) }), `cut at ${cut}`).toThrow(/Invalid cell data/);
    }
    expect(() => read({ ...save, cells: '' })).toThrow(/Invalid cell data/);
  });

  it('rejects a cell list longer than the template', () => {
    const save = JSON.parse(serialize(workingMap())) as { cells: string };
    expect(() => read({ ...save, cells: `${save.cells},_` })).toThrow(/more cells than the map template holds/);
  });

  it('a JSON file cut anywhere fails to import and leaves the live map alone', async () => {
    const state = workingMap();
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    exec.execute(paintCmd([{ x: 30, y: 30 }], TerrainType.Mountain, 1));
    whole.commit();
    const json = serializeWithSections(exportable(state), {
      carry: carrying('annotations', 'notes', 'provenance', 'history', 'stats', 'catalog'), pretty: false,
      history: { entries: exec.getUndoEntries(), depth: 'all' },
    });
    const loadMap = vi.fn();
    const cuts = [1, 10, Math.floor(json.length * 0.25), json.indexOf('"cells"') + 20, json.indexOf('"history"') + 30, json.length - 1];
    for (const cut of cuts) {
      const outcome = await importFile(new Blob([json.slice(0, cut)], { type: 'application/json' }), 'map.json', {
        loadMap, getSectionDeps: () => { throw new Error('unreachable'); },
      });
      expect(outcome.status, `cut at ${cut}`).toBe('failed');
    }
    expect(loadMap).not.toHaveBeenCalled();
  });

  it('a history section cut short drops only the history and keeps the map', async () => {
    const state = workingMap();
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    exec.execute(paintCmd([{ x: 30, y: 30 }], TerrainType.Mountain, 1));
    whole.commit();
    const json = serializeWithSections(exportable(state), {
      carry: carrying('annotations', 'notes', 'provenance', 'history'), pretty: false,
      history: { entries: exec.getUndoEntries(), depth: 'all' },
    });
    const parsed = JSON.parse(json) as { history: { entries: Array<Record<string, unknown>> } };
    // A valid JSON whose last entry lost its trailing fields, as a hand edit or partial copy leaves it.
    const { after: _after, ...cut } = parsed.history.entries[0]!;
    parsed.history.entries[0] = cut;
    const restored = vi.fn();
    let loaded: GridState | null = null;
    const outcome = await importFile(new Blob([JSON.stringify(parsed)], { type: 'application/json' }), 'map.json', {
      loadMap: (s) => { loaded = s; },
      getSectionDeps: () => ({ executor: { restoreHistory: restored }, state: loaded!, setLayerLocked: () => {}, setCamera: () => {} }),
    });
    expect(outcome.status).toBe('imported');
    expect(restored).not.toHaveBeenCalled();
    expect(outcome.status === 'imported' && outcome.warnings).toContainEqual({ kind: 'dropped-section', section: 'history' });
    expect(loaded!.cells[30]![30]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 });
  });
});

describe('save versions', () => {
  it('opens the frozen v1 fixture through the whole migration chain', () => {
    const raw = structuredClone(legacyV1);
    const migrated = migrateToCurrent(raw);
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(raw.version).toBe(1);
    const state = read(legacyV1);
    expect(state.template.id).toBe('hexia');
    // The fixture paints cells 5..12 of the first row with t1:1.
    for (let x = 5; x < 13; x++) expect(state.cells[0]![x]!.terrain).toMatchObject({ type: 1, elevation: 1 });
    expect(state.cells[0]![4]!.terrain).toBeNull();
  });

  it('a v1 save with undo history opens without the history, which no longer matches the landmarks', () => {
    const save = JSON.parse(serialize(workingMap())) as Record<string, unknown>;
    const migrated = migrateToCurrent({ ...save, version: 1, history: { v: 1, totalSteps: 0, entries: [] } });
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect('history' in migrated).toBe(false);
  });

  it.each([0, -1, 1.5, 2.5])('refuses a save stamped with version %s, which no build wrote', (version) => {
    const save = JSON.parse(serialize(workingMap())) as Record<string, unknown>;
    expect(() => migrateToCurrent({ ...save, version })).toThrow(ImportError);
    expect(() => read({ ...save, version })).toThrow(ImportError);
  });
});
