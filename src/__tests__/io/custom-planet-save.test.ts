import { describe, it, expect } from 'vitest';
import { buildSaveFile, deserializeParsed, serialize, templateOfSave } from '../../io/json-codec';
import { serializeTemplate } from '../../io/planet-codec';
import { createGridState } from '../../core/model/planet';
import { inspectImportFile } from '../../io/import-file';
import { sectionSizes } from '../../io/export-json';
import { planetFixture, pondMask } from '../fixtures/planet';
import { jsonFile } from '../fixtures/json-file';
import { getMapTemplate } from '../../config/maps';
import { TerrainType } from '../../core/model/types';
import { landmarkAt } from '../fixtures/planet';

describe('saves on a custom planet', () => {
  it('embed the template and reopen without a library', async () => {
    const t = planetFixture();
    const state = createGridState(t);
    state.cells[8]![8]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
    const file = buildSaveFile(state);
    expect(file.template).toEqual(serializeTemplate(t));
    const raw = JSON.parse(serialize(state));
    const back = deserializeParsed(raw, templateOfSave(raw));
    expect(back.template.id).toBe(t.id);
    expect(back.cells[8]![8]!.terrain?.elevation).toBe(1);
    const inspected = await inspectImportFile(jsonFile(serialize(state)), 'map.json');
    expect(inspected.status).not.toBe('failed');
    if (inspected.status === 'ready') expect(inspected.preview.state.template.id).toBe(t.id);
  });
  it('embed a planet with a pond and reopen it with the water in place', () => {
    const t = planetFixture({ water: pondMask([[30, 20]]) });
    const raw = JSON.parse(serialize(createGridState(t)));
    const back = deserializeParsed(raw, templateOfSave(raw));
    expect(back.template).toEqual(t);
    expect(back.cells[20]![30]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: 0 });
  });
  it('rejects an embedded template that fails validation', () => {
    const raw = JSON.parse(serialize(createGridState(planetFixture())));
    raw.template.zones = raw.template.zones.replace(/2/, '7');
    expect(() => templateOfSave(raw)).toThrow();
  });
  it('reports a failed import for an invalid embedded template', async () => {
    const raw = JSON.parse(serialize(createGridState(planetFixture())));
    raw.template.zones = raw.template.zones.replace(/2/, '7');
    expect((await inspectImportFile(jsonFile(JSON.stringify(raw)), 'map.json')).status).toBe('failed');
  });
  it('reports a failed import for an unknown template id without an embedded planet', async () => {
    const raw = JSON.parse(serialize(createGridState(planetFixture())));
    delete raw.template;
    expect((await inspectImportFile(jsonFile(JSON.stringify(raw)), 'map.json')).status).toBe('failed');
  });
  it('opens a built-in save whatever stray template field it carries', () => {
    const raw = JSON.parse(serialize(createGridState(getMapTemplate('hexia'))));
    raw.template = { zones: 'not a planet' };
    expect(templateOfSave(raw).id).toBe('hexia');
  });
  it.each([90, 270] as const)('round-trips a plaza turned %s degrees', (rotation) => {
    const t = planetFixture({ plaza: landmarkAt(12.5, 3.5, rotation) });
    const raw = JSON.parse(serialize(createGridState(t)));
    const back = deserializeParsed(raw, templateOfSave(raw));
    expect(back.template).toEqual(t);
    const plaza = [...back.objects.values()].find((o) => o.width !== undefined)!;
    expect(plaza).toMatchObject({ rotation, width: t.plaza.width, height: t.plaza.height, locked: true });
  });
  it('built-in saves carry no template', () => {
    expect('template' in buildSaveFile(createGridState(getMapTemplate('hexia')))).toBe(false);
  });
  it('counts the embedded template in the core section size', () => {
    const state = createGridState(planetFixture());
    const embedded = JSON.stringify(serializeTemplate(state.template)).length;
    expect(sectionSizes(state, { includeGeneration: false, includeProvenance: false, includeStats: false, includeCatalogInfo: false, pretty: false }, { withTotal: false }).core).toBeGreaterThan(embedded);
  });
});
