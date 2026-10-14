import { describe, it, expect } from 'vitest';
import { type MapTemplate } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { isTrustedPlanet, validatePlanetTemplate } from '../../../core/model/planet-validate';
import { planetTemplateId, PLANET_MAX_CELLS } from '../../../core/model/planet';
import { landmarkAt } from '../../_support/planet';
import { templateAnchor } from '../../../core/model/landmarks';
import { LANDMARKS } from '../../../core/game/profile';

const G = CellZone.Grass, B = CellZone.Beach, V = CellZone.Void;
const ok = (): MapTemplate => ({ id: 'custom-00000000', name: { en: 'P' }, width: 32, height: 32, zones: Array.from({ length: 32 }, () => Array(32).fill(G)), landmarks: [landmarkAt(2.5, 2)] });

/** The coast landmark of the profile. */
const COAST = LANDMARKS.find((l) => l.ground === 'coast')!;

/** A 40 x 40 planet: grass rows 0 to 9, a sand strip on rows 10 and 11, then sea. */
const coastal = (): MapTemplate => ({
  id: 'custom-00000000', name: { en: 'C' }, width: 40, height: 40,
  zones: Array.from({ length: 40 }, (_, y) => Array(40).fill(y < 10 ? G : y < 12 ? B : V)),
  landmarks: [],
});

describe('validatePlanetTemplate', () => {
  it('accepts a well-formed planet', () => { expect(validatePlanetTemplate(ok())).toBeNull(); });
  it('rejects sizes over the cap', () => { const t = ok(); t.width = PLANET_MAX_CELLS + 1; expect(validatePlanetTemplate(t)).toBe('size'); });
  it('rejects rows of the wrong length', () => { const t = ok(); t.zones[3] = [G]; expect(validatePlanetTemplate(t)).toBe('zones'); });
  it('rejects zone values out of range', () => { const t = ok(); t.zones[0]![0] = 9 as CellZone; expect(validatePlanetTemplate(t)).toBe('zones'); });
  it('rejects a plaza off the half-cell grid', () => { const t = ok(); templateAnchor(t)!.x = 2.25; expect(validatePlanetTemplate(t)).toBe('landmark'); });
  it('rejects a plaza standing on non-grass', () => { const t = ok(); t.zones[5]![5] = CellZone.Void; expect(validatePlanetTemplate(t)).toBe('landmark'); });
  it('rejects terrain of the wrong length or height', () => {
    const t = ok(); t.terrain = new Uint8Array(3); expect(validatePlanetTemplate(t)).toBe('terrain');
    const u = ok(); u.terrain = new Uint8Array(32 * 32).fill(9); expect(validatePlanetTemplate(u)).toBe('terrain');
  });
  it('accepts a water mask and rejects one of the wrong length or with values other than 0 and 1', () => {
    const t = ok(); t.water = new Uint8Array(32 * 32); t.water[40] = 1; expect(validatePlanetTemplate(t)).toBeNull();
    const u = ok(); u.water = new Uint8Array(3); expect(validatePlanetTemplate(u)).toBe('terrain');
    const v = ok(); v.water = new Uint8Array(32 * 32).fill(2); expect(validatePlanetTemplate(v)).toBe('terrain');
  });
  it('rejects a plaza rotation off the quarter turns', () => { const t = ok(); templateAnchor(t)!.rotation = 45 as never; expect(validatePlanetTemplate(t)).toBe('landmark'); });
  it('accepts a planet without landmarks on any zones', () => { const t = ok(); t.landmarks = []; t.zones[0]![0] = CellZone.Void; expect(validatePlanetTemplate(t)).toBeNull(); });
  it('rejects a zero-size landmark, an unknown landmark and a second one of the same kind', () => {
    const z = ok(); z.landmarks = [{ ...landmarkAt(2.5, 2), width: 0 }]; expect(validatePlanetTemplate(z)).toBe('landmark');
    const u = ok(); u.landmarks = [{ ...landmarkAt(2.5, 2), id: 'tree-apple' }]; expect(validatePlanetTemplate(u)).toBe('landmark');
    const d = ok(); d.landmarks = [landmarkAt(2.5, 2), landmarkAt(2.5, 2)]; expect(validatePlanetTemplate(d)).toBe('landmark');
  });
  it('rejects malformed chunk grids', () => {
    for (const g of ['x', null, { origin: { x: 0, y: 0 }, columns: 1e9, rows: 2 }, { origin: { x: 0, y: 0 }, columns: 0, rows: 2 }, { origin: { x: NaN, y: 0 }, columns: 2, rows: 2 }, { origin: { x: 0, y: 0 }, columns: 2.5, rows: 2 }]) {
      const t = ok(); t.chunkGrid = g as never; expect(validatePlanetTemplate(t)).toBe('size');
    }
    const t = ok(); t.chunkGrid = { origin: { x: -1, y: 0 }, columns: 2, rows: 2 }; expect(validatePlanetTemplate(t)).toBeNull();
  });
  it('rejects ids outside the custom namespace', () => { const t = ok(); t.id = 'hexia'; expect(validatePlanetTemplate(t)).toBe('id'); });
});

describe('a coast landmark', () => {
  it('stands with its north edge on the shore and the rest out over the sea', () => {
    const t = coastal(); t.landmarks = [landmarkAt(8.5, 11, undefined, COAST)];
    expect(validatePlanetTemplate(t)).toBeNull();
  });
  it('is refused on grass, away from the shore, or short of open sea at its far edge', () => {
    const onGrass = coastal(); onGrass.landmarks = [landmarkAt(8.5, 9, undefined, COAST)];
    expect(validatePlanetTemplate(onGrass)).toBe('landmark');
    const adrift = coastal(); adrift.landmarks = [landmarkAt(8.5, 13, undefined, COAST)];
    expect(validatePlanetTemplate(adrift)).toBe('landmark');
    const blocked = coastal(); blocked.zones[11 + COAST.height - 1]![10] = B; blocked.landmarks = [landmarkAt(8.5, 11, undefined, COAST)];
    expect(validatePlanetTemplate(blocked)).toBe('landmark');
  });
  it('shares a planet with the plaza', () => {
    const plaza = LANDMARKS.find((l) => l.anchor)!;
    const sandRow = plaza.height + 1;
    const t: MapTemplate = { ...coastal(), height: 60, zones: Array.from({ length: 60 }, (_, y) => Array(40).fill(y < sandRow ? G : y < sandRow + 2 ? B : V)) };
    t.landmarks = [landmarkAt(2, 0), landmarkAt(8.5, sandRow + 1, undefined, COAST)];
    expect(validatePlanetTemplate(t)).toBeNull();
  });
});

describe('isTrustedPlanet', () => {
  it('trusts a valid planet only under the id its content hashes to', () => {
    const t = ok();
    expect(isTrustedPlanet(t)).toBe(false);
    t.id = planetTemplateId(t);
    expect(isTrustedPlanet(t)).toBe(true);
    t.zones[5]![5] = CellZone.Void;
    expect(isTrustedPlanet({ ...t, id: planetTemplateId(t) })).toBe(false);
  });
});
