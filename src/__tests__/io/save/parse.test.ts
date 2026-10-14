// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSave } from '../../../io/save/parse';
import { decodeSave, serialize } from '../../../io/save/json-codec';
import { importFile, type ImportFileDeps } from '../../../io/import/file';
import { createGrid } from '../../../core/model/grid-model';
import { getMapTemplate } from '../../../config/maps';
import type { GridState } from '../../../core/model/types';
import { jsonFile } from '../../_support/json-file';
import v1Fixture from '../../fixtures/saves/legacy-v1-no-provenance.json';

vi.mock('../../../io/save/format/migrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../io/save/format/migrate')>();
  return { ...actual, migrateToCurrent: vi.fn(actual.migrateToCurrent) };
});
import { migrateToCurrent } from '../../../io/save/format/migrate';

function makeState(): GridState {
  const template = getMapTemplate(undefined);
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

function saveRecord(): Record<string, unknown> {
  return JSON.parse(serialize(makeState())) as Record<string, unknown>;
}

describe('parseSave', () => {
  beforeEach(() => { vi.mocked(migrateToCurrent).mockClear(); });

  it('migrates a save once for a decode', () => {
    decodeSave(parseSave(structuredClone(v1Fixture)));
    expect(migrateToCurrent).toHaveBeenCalledTimes(1);
  });

  it('migrates a save once for a JSON file import, sections included', async () => {
    const deps: ImportFileDeps = {
      loadMap: vi.fn(),
      getSectionDeps: () => ({ executor: null, state: makeState(), setLayerLocked: vi.fn(), setCamera: vi.fn() }),
    };
    const outcome = await importFile(jsonFile(JSON.stringify(v1Fixture)), 'map.json', deps);
    expect(outcome.status).toBe('imported');
    expect(migrateToCurrent).toHaveBeenCalledTimes(1);
  });

  it('reports the version the save was written at, reading a missing version as 1', () => {
    expect(parseSave(saveRecord()).fromVersion).toBe(saveRecord().version);
    const { version: _version, ...unversioned } = saveRecord();
    expect(parseSave(unversioned).fromVersion).toBe(1);
  });

  it.each([
    ['a null root', null],
    ['an array root', []],
    ['a string root', 'save'],
  ])('rejects %s as a malformed envelope', (_label, raw) => {
    expect(() => parseSave(raw)).toThrow(expect.objectContaining({ code: 'malformed' }));
  });

  it.each([
    ['missing objects', (s: Record<string, unknown>) => { delete s.objects; }],
    ['objects as a string', (s: Record<string, unknown>) => { s.objects = 'xy'; }],
    ['objects as a length record', (s: Record<string, unknown>) => { s.objects = { length: 1 }; }],
    ['cells as a list', (s: Record<string, unknown>) => { s.cells = ['G']; }],
    ['missing cells', (s: Record<string, unknown>) => { delete s.cells; }],
  ])('rejects a save with %s as a malformed envelope', (_label, damage) => {
    const save = saveRecord();
    damage(save);
    expect(() => parseSave(save)).toThrow(expect.objectContaining({ code: 'malformed' }));
  });
});
