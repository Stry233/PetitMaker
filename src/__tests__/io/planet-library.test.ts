import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listPlanets, savePlanet, adoptPlanet, renamePlanet, duplicatePlanet, removePlanet,
  planetLibraryVersion, onPlanetLibraryChange, settlePlanetName, shownAs, shownPlanetName, withShownPlanetName,
} from '../../io/planet-library';
import { serializeTemplate } from '../../io/planet-codec';
import { serialize, templateOfSave } from '../../io/json-codec';
import { encodeMapPayload, decodeMapPayload } from '../../io/share/codec/payload';
import { planetFixture, NO_PLAZA } from '../fixtures/planet';
import { CellZone } from '../../core/model/types';
import { createGridState, deriveBoundary, planetTemplateId } from '../../core/model/planet';

const KEY = 'petit-planet-custom-planets';

describe('the planet library', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('lists a saved planet', () => {
    const t = planetFixture();
    const saved = savePlanet('Bay', t);
    expect(saved.ok).toBe(true);
    const list = listPlanets();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Bay');
    expect(list[0]!.template).toEqual(t);
    if (saved.ok) expect(list[0]!.entryId).toBe(saved.entry.entryId);
  });

  it('replaces an entry in place', () => {
    const first = savePlanet('Bay', planetFixture());
    if (!first.ok) throw new Error('save failed');
    const other = planetFixture({ plaza: NO_PLAZA });
    const second = savePlanet('Reef', other, { replaceEntryId: first.entry.entryId });
    expect(second.ok && second.entry.entryId).toBe(first.entry.entryId);
    expect(listPlanets().map((e) => [e.name, e.template.id])).toEqual([['Reef', other.id]]);
    expect(listPlanets()[0]!.createdAt).toBe(first.entry.createdAt);
  });

  it('keeps the sand under the rim on the rim cells it names, through duplication and not past a replacement', () => {
    const { id: _id, name, ...body } = planetFixture();
    const shored = { ...body, zones: deriveBoundary(body.zones) };
    const t = { id: planetTemplateId(shored), name, ...shored };
    const rim = t.zones.flatMap((row, y) => row.flatMap((z, x) => (z === CellZone.Boundary ? [y * t.width + x] : [])));
    const inside = t.zones.flatMap((row, y) => row.flatMap((z, x) => (z === CellZone.Grass ? [y * t.width + x] : [])));
    expect(rim.length).toBeGreaterThan(1);
    const saved = savePlanet('Bay', t, { rimSand: [rim[0]!, inside[0]!, -1, 1.5] });
    if (!saved.ok) throw new Error('save failed');
    expect(listPlanets()[0]!.rimSand).toEqual([rim[0]]);
    expect(listPlanets()[0]!.template.id).toBe(t.id);
    const copy = duplicatePlanet(saved.entry.entryId, 'Bay copy');
    expect(copy?.rimSand).toEqual([rim[0]]);
    savePlanet('Bay', t, { replaceEntryId: saved.entry.entryId });
    expect(listPlanets()[0]!.rimSand).toBeUndefined();
  });

  it('adopts a known planet once', () => {
    const t = planetFixture();
    const saved = savePlanet('Bay', t);
    const adopted = adoptPlanet(t);
    expect(saved.ok && adopted.entryId).toBe(saved.ok && saved.entry.entryId);
    expect(listPlanets()).toHaveLength(1);
  });

  it('adopts a different planet as a new entry', () => {
    savePlanet('Bay', planetFixture());
    const other = planetFixture({ plaza: NO_PLAZA });
    const adopted = adoptPlanet(other, 'Shared');
    expect(adopted.name).toBe('Shared');
    expect(listPlanets().map((e) => e.template.id)).toContain(other.id);
    expect(listPlanets()).toHaveLength(2);
  });

  it('names an adopted planet after its template when no name is given', () => {
    expect(adoptPlanet(planetFixture()).name).toBe('Bay');
  });

  it('renames, duplicates and removes entries', () => {
    const saved = savePlanet('Bay', planetFixture());
    if (!saved.ok) throw new Error('save failed');
    const id = saved.entry.entryId;
    renamePlanet(id, 'Cove');
    expect(listPlanets()[0]!.name).toBe('Cove');
    const copy = duplicatePlanet(id, 'Cove copy');
    expect(copy?.entryId).not.toBe(id);
    expect(listPlanets().map((e) => e.name)).toEqual(['Cove', 'Cove copy']);
    expect(listPlanets()[1]!.template).toEqual({ ...listPlanets()[0]!.template, name: { en: 'Cove copy' } });
    removePlanet(id);
    expect(listPlanets().map((e) => e.name)).toEqual(['Cove copy']);
  });

  it('gives a renamed planet its new name wherever the planet goes', async () => {
    const saved = savePlanet('Bay', planetFixture());
    if (!saved.ok) throw new Error('save failed');
    renamePlanet(saved.entry.entryId, 'Harbor');
    const template = listPlanets()[0]!.template;
    expect(template.name).toEqual({ en: 'Harbor' });
    expect(template.id).toBe(saved.entry.template.id);
    const state = createGridState(template);
    expect(templateOfSave(JSON.parse(serialize(state))).name.en).toBe('Harbor');
    const shared = await decodeMapPayload(await encodeMapPayload(state, null, { appVersion: '1.0-test', saveVersion: 3 }));
    expect(shared.template?.name.en).toBe('Harbor');
  });

  it('names a saved, duplicated or adopted planet after its entry', () => {
    const saved = savePlanet('Reef', planetFixture());
    expect(saved.ok && saved.entry.template.name.en).toBe('Reef');
    expect(listPlanets()[0]!.template.name.en).toBe('Reef');
    if (saved.ok) expect(duplicatePlanet(saved.entry.entryId, 'Reef copy')?.template.name.en).toBe('Reef copy');
    expect(adoptPlanet(planetFixture({ plaza: NO_PLAZA }), 'Shared').template.name.en).toBe('Shared');
  });

  it('reports quota and leaves the library unchanged', () => {
    savePlanet('Bay', planetFixture());
    const before = localStorage.getItem(KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(savePlanet('Reef', planetFixture({ plaza: NO_PLAZA }))).toEqual({ ok: false, reason: 'quota' });
    vi.restoreAllMocks();
    expect(localStorage.getItem(KEY)).toBe(before);
    expect(listPlanets()).toHaveLength(1);
  });

  it('reads a corrupted record as an empty library', () => {
    localStorage.setItem(KEY, '{not json');
    expect(listPlanets()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: 'nope' }));
    expect(listPlanets()).toEqual([]);
  });

  it('drops an entry whose template is invalid', () => {
    const good = serializeTemplate(planetFixture());
    const bad = { ...good, zones: good.zones.replace(/2/, '7') };
    const entry = (entryId: string, template: unknown) => ({ entryId, name: entryId, template, createdAt: 1, updatedAt: 1 });
    localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: [entry('a', bad), entry('b', good)] }));
    expect(listPlanets().map((e) => e.entryId)).toEqual(['b']);
  });

  it('notifies listeners and bumps the version after each write', () => {
    const fn = vi.fn();
    const off = onPlanetLibraryChange(fn);
    const v0 = planetLibraryVersion();
    const saved = savePlanet('Bay', planetFixture());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(planetLibraryVersion()).toBe(v0 + 1);
    if (saved.ok) renamePlanet(saved.entry.entryId, 'Cove');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    savePlanet('Reef', planetFixture({ plaza: NO_PLAZA }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('completes a save when a listener throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const off = onPlanetLibraryChange(() => { throw new Error('listener'); });
    const after = vi.fn();
    const offAfter = onPlanetLibraryChange(after);
    expect(savePlanet('Bay', planetFixture()).ok).toBe(true);
    expect(after).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalled();
    expect(listPlanets()).toHaveLength(1);
    off(); offAfter();
  });

  it('keeps an adopted name unreviewed until its check is settled, and a written name reviewed', () => {
    const bay = adoptPlanet(planetFixture(), 'Bay');
    expect(listPlanets()[0]!.nameReviewed).toBe(false);
    expect(settlePlanetName(bay.entryId, 'Other', null)).toBe(false);
    expect(settlePlanetName(bay.entryId, 'Bay', null)).toBe(true);
    expect(listPlanets()[0]).toMatchObject({ name: 'Bay', nameReviewed: true });
    expect(settlePlanetName(bay.entryId, 'Bay', 'My planet 1')).toBe(false);

    const cove = adoptPlanet(planetFixture({ plaza: NO_PLAZA }), 'Cove');
    expect(settlePlanetName(cove.entryId, 'Cove', 'My planet 2')).toBe(true);
    const settled = listPlanets()[1]!;
    expect([settled.name, settled.nameReviewed, settled.template.name.en]).toEqual(['My planet 2', true, 'My planet 2']);

    const reef = adoptPlanet(planetFixture({ terrain: null }), 'Reef');
    renamePlanet(reef.entryId, 'Reef');
    expect(listPlanets()[2]!.nameReviewed).toBe(true);
    expect(savePlanet('Lagoon', planetFixture({ terrain: null }), { replaceEntryId: reef.entryId, nameReviewed: false }).ok).toBe(true);
    expect(listPlanets()[2]!.nameReviewed).toBe(false);
  });

  it('reads an entry stored without a review mark as unreviewed', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: [{ entryId: 'e1', name: 'Bay', template: serializeTemplate(planetFixture()), createdAt: 1, updatedAt: 1 }] }));
    expect(listPlanets()[0]!.nameReviewed).toBe(false);
  });

  it('shows an entry under another name without changing the library', () => {
    const saved = savePlanet('Bay', planetFixture());
    if (!saved.ok) throw new Error('save failed');
    const shown = shownAs(saved.entry, 'My planet 1');
    expect([shown.name, shown.template.name.en, shown.template.id]).toEqual(['My planet 1', 'My planet 1', saved.entry.template.id]);
    expect(listPlanets()[0]!.name).toBe('Bay');
  });

  it('names a planet by its library entry once reviewed, and by the default name before', () => {
    const template = { ...planetFixture(), name: { en: 'Bay' } };
    expect(shownPlanetName(template, 'en')).toBe('My planet 1');
    const bay = adoptPlanet(template);
    expect(shownPlanetName(template, 'en')).toBe('My planet 1');
    settlePlanetName(bay.entryId, 'Bay', null);
    expect(shownPlanetName(template, 'en')).toBe('Bay');
    renamePlanet(bay.entryId, 'Reef');
    expect(shownPlanetName(template, 'en')).toBe('Reef');
    const state = createGridState(template);
    expect(withShownPlanetName(state, 'en').template).toMatchObject({ id: template.id, name: { en: 'Reef' } });
    expect(state.template.name.en).toBe('Bay');
  });
});
