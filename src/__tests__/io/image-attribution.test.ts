import { beforeEach, describe, expect, it } from 'vitest';
import { getMapTemplate } from '../../config/maps';
import { createGrid } from '../../core/model/grid-model';
import { CellZone, TerrainType, type GridState } from '../../core/model/types';
import { captureImageAttribution, protectedImageNotes } from '../../core/provenance/image-attribution';
import { buildShareCode } from '../../io/share/export';
import { importFromRaster } from '../../io/share/import';
import { deserialize, serialize } from '../../io/json-codec';
import { serializeWithSections, verifyIntegrity, type ExportJsonOptions } from '../../io/export-json';
import { prepareOwnImageReceipt, isOwnImageExport } from '../../io/image-ownership';
import { readPref } from '../../core/runtime/prefs';
import { makeExecutor } from '../rules/_helpers';

function map(): GridState {
  const template = getMapTemplate(undefined);
  const state: GridState = { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(), notes: { title: 'Garden', description: 'A riverside walk' } };
  let count = 0;
  for (const row of state.cells) for (const cell of row) {
    if (cell.zone === CellZone.Grass && count++ < 10) cell.terrain = { type: TerrainType.Mountain, elevation: 1 };
  }
  return state;
}

const OPTIONS: ExportJsonOptions = { notes: null, includeGeneration: false, includeProvenance: false, includeStats: false, includeCatalogInfo: false, pretty: false };
const META = { appVersion: 'test', saveVersion: 1 };

beforeEach(() => localStorage.clear());

describe('image attribution round trips', () => {
  it('starts protection only on the image path and carries it through a section-free JSON export', async () => {
    const state = map();
    expect(deserialize(serialize(state), state.template).imageAttribution).toBeUndefined();
    const glyph = await buildShareCode(state, null, META, 1600);
    const imported = await importFromRaster(glyph!.rgba, glyph!.width, glyph!.height);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(protectedImageNotes(imported.state)).toEqual(state.notes);
    const saved = serializeWithSections(imported.state, OPTIONS);
    expect(JSON.parse(saved).provenance).toBeUndefined();
    const restored = deserialize(saved, state.template);
    expect(protectedImageNotes(restored)).toEqual(state.notes);
    expect(restored.notes).toEqual(state.notes);
  });

  it.each(['ai', 'procedural'] as const)('exempts an imported %s image', async (source) => {
    const state = map();
    const summary = makeExecutor(state).getProvenanceSummary();
    const glyph = await buildShareCode(state, { ...summary, containsAi: source === 'ai', containsProcedural: source === 'procedural' }, META, 1600);
    const imported = await importFromRaster(glyph!.rgba, glyph!.width, glyph!.height);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.state.imageAttribution).toBeUndefined();
  });

  it('restores original notes after a manual JSON edit and preserves the integrity warning', () => {
    const state = map();
    state.imageAttribution = captureImageAttribution(state);
    const raw = JSON.parse(serializeWithSections(state, OPTIONS));
    raw.notes = { title: 'Replacement', description: 'Replacement' };
    expect(verifyIntegrity(raw)).toBe('modified');
    const restored = deserialize(JSON.stringify(raw), state.template);
    expect(restored.notes).toEqual(state.notes);
    expect(protectedImageNotes(restored)).toEqual(state.notes);
  });

  it('retains attribution in the plain autosave format', () => {
    const state = map();
    state.imageAttribution = captureImageAttribution(state);
    expect(deserialize(serialize(state), state.template).imageAttribution).toEqual(state.imageAttribution);
  });

  it('keeps ordinary JSON Notes omission and legacy loading unchanged', () => {
    const state = map();
    const saved = serializeWithSections(state, OPTIONS);
    expect(JSON.parse(saved).notes).toBeUndefined();
    expect(deserialize(saved, state.template).imageAttribution).toBeUndefined();
  });

  it('rejects malformed attribution records without changing older files', () => {
    const state = map();
    const raw = JSON.parse(serialize(state));
    raw.imageAttribution = { version: 1, templateId: state.template.id, notes: state.notes, units: [null] };
    expect(() => deserialize(JSON.stringify(raw), state.template)).toThrow('Invalid image attribution');
  });

  it('keeps protected text in a re-exported image even when editable notes differ', async () => {
    const state = map();
    state.imageAttribution = captureImageAttribution(state);
    state.notes = { title: 'Replacement' };
    const glyph = await buildShareCode(state, null, META, 1600);
    const imported = await importFromRaster(glyph!.rgba, glyph!.width, glyph!.height);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.state.notes).toEqual(state.imageAttribution!.notes);
  });
});


describe('private image export receipts', () => {
  it('recognizes a decoded own image only after the successful download is recorded', async () => {
    const state = map();
    const record = await prepareOwnImageReceipt(state);
    expect(await isOwnImageExport(state)).toBe(false);
    record();
    const code = await buildShareCode(state, null, META, 1600);
    const imported = await importFromRaster(code!.rgba, code!.width, code!.height);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(await isOwnImageExport(imported.state)).toBe(true);
    imported.state.notes = { title: 'Different title' };
    delete imported.state.imageAttribution;
    expect(await isOwnImageExport(imported.state)).toBe(false);
  });

  it('does not claim protected imports and retains no map text or browser identity', async () => {
    const state = map();
    state.imageAttribution = captureImageAttribution(state);
    (await prepareOwnImageReceipt(state))();
    expect(readPref('ownImageExports')).toBe('');
    delete state.imageAttribution;
    (await prepareOwnImageReceipt(state))();
    const stored = JSON.parse(readPref('ownImageExports'));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(serialize(state)).not.toContain(stored[0]);
    expect(serializeWithSections(state, OPTIONS)).not.toContain(stored[0]);
    localStorage.clear();
    expect(await isOwnImageExport(state)).toBe(false);
  });
});
