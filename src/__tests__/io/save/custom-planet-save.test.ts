import { describe, it, expect } from 'vitest';
import { buildSaveFile, serialize, decodeSave } from '../../../io/save/json-codec';
import { parseSave } from '../../../io/save/parse';
import { serializeTemplate } from '../../../io/save/planet-codec';
import { createGridState } from '../../../core/model/template';
import { inspectImportFile } from '../../../io/import/file';
import { carrying, sectionSizeFormats } from '../../../io/save/sections';
import { planetFixture, pondMask, landmarkAt } from '../../_support/planet';
import { jsonFile } from '../../_support/json-file';
import { getMapTemplate } from '../../../config/maps';
import { TerrainType } from '../../../core/model/types';
import { templateAnchor } from '../../../core/model/landmarks';
import { exportable } from '../../_support/exportable';

describe('saves on a custom planet', () => {
  it('embed the template and reopen without a library', async () => {
    const t = planetFixture();
    const state = createGridState(t);
    state.cells[8]![8]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
    const file = buildSaveFile(state);
    expect(file.template).toEqual(serializeTemplate(t));
    const raw = JSON.parse(serialize(state));
    const back = decodeSave(parseSave(raw));
    expect(back.template.id).toBe(t.id);
    expect(back.cells[8]![8]!.terrain?.elevation).toBe(1);
    const inspected = await inspectImportFile(jsonFile(serialize(state)), 'map.json');
    expect(inspected.status).not.toBe('failed');
    if (inspected.status === 'ready') expect(inspected.preview.state.template.id).toBe(t.id);
  });
  it('embed a planet with a pond and reopen it with the water in place', () => {
    const t = planetFixture({ water: pondMask([[40, 20]]) });
    const raw = JSON.parse(serialize(createGridState(t)));
    const back = decodeSave(parseSave(raw));
    expect(back.template).toEqual(t);
    expect(back.cells[20]![40]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: 0 });
  });
  it('rejects an embedded template that fails validation', () => {
    const raw = JSON.parse(serialize(createGridState(planetFixture())));
    raw.template.zones = raw.template.zones.replace(/2/, '7');
    expect(() => parseSave(raw)).toThrow();
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
    expect(parseSave(raw).template.id).toBe('hexia');
  });
  it.each([90, 270] as const)('round-trips a plaza turned %s degrees', (rotation) => {
    const t = planetFixture({ plaza: landmarkAt(12.5, 3, rotation) });
    const raw = JSON.parse(serialize(createGridState(t)));
    const back = decodeSave(parseSave(raw));
    expect(back.template).toEqual(t);
    const plaza = [...back.objects.values()].find((o) => o.width !== undefined)!;
    expect(plaza).toMatchObject({ rotation, width: templateAnchor(t)!.width, height: templateAnchor(t)!.height, locked: true });
  });
  it('built-in saves carry no template', () => {
    expect('template' in buildSaveFile(createGridState(getMapTemplate('hexia')))).toBe(false);
  });
  it('counts the embedded template in the core section size', () => {
    const state = createGridState(planetFixture());
    const embedded = JSON.stringify(serializeTemplate(state.template)).length;
    const lean = { carry: carrying('annotations', 'notes'), pretty: false };
    expect(sectionSizeFormats(exportable(state), lean).compact.core).toBeGreaterThan(embedded);
  });
});
