import { describe, it, expect } from 'vitest';
import { CellZone, type MapTemplate } from '../../../core/model/types';
import { isTrustedPlanet, validatePlanetTemplate } from '../../../core/model/planet-validate';
import { planetTemplateId, PLANET_MAX_CELLS } from '../../../core/model/planet';
import { landmarkAt } from '../../fixtures/planet';

const G = CellZone.Grass;
const ok = (): MapTemplate => ({ id: 'custom-00000000', name: { en: 'P' }, width: 32, height: 32, zones: Array.from({ length: 32 }, () => Array(32).fill(G)), plaza: landmarkAt(2.5, 2) });

describe('validatePlanetTemplate', () => {
  it('accepts a well-formed planet', () => { expect(validatePlanetTemplate(ok())).toBeNull(); });
  it('rejects sizes over the cap', () => { const t = ok(); t.width = PLANET_MAX_CELLS + 1; expect(validatePlanetTemplate(t)).toBe('size'); });
  it('rejects rows of the wrong length', () => { const t = ok(); t.zones[3] = [G]; expect(validatePlanetTemplate(t)).toBe('zones'); });
  it('rejects zone values out of range', () => { const t = ok(); t.zones[0]![0] = 9 as CellZone; expect(validatePlanetTemplate(t)).toBe('zones'); });
  it('rejects a plaza off the half-cell grid', () => { const t = ok(); t.plaza.x = 2.25; expect(validatePlanetTemplate(t)).toBe('plaza'); });
  it('rejects a plaza standing on non-grass', () => { const t = ok(); t.zones[5]![5] = CellZone.Void; expect(validatePlanetTemplate(t)).toBe('plaza'); });
  it('rejects terrain of the wrong length or height', () => {
    const t = ok(); t.terrain = new Uint8Array(3); expect(validatePlanetTemplate(t)).toBe('terrain');
    const u = ok(); u.terrain = new Uint8Array(32 * 32).fill(9); expect(validatePlanetTemplate(u)).toBe('terrain');
  });
  it('accepts a water mask and rejects one of the wrong length or with values other than 0 and 1', () => {
    const t = ok(); t.water = new Uint8Array(32 * 32); t.water[40] = 1; expect(validatePlanetTemplate(t)).toBeNull();
    const u = ok(); u.water = new Uint8Array(3); expect(validatePlanetTemplate(u)).toBe('terrain');
    const v = ok(); v.water = new Uint8Array(32 * 32).fill(2); expect(validatePlanetTemplate(v)).toBe('terrain');
  });
  it('rejects a plaza rotation off the quarter turns', () => { const t = ok(); t.plaza.rotation = 45 as never; expect(validatePlanetTemplate(t)).toBe('plaza'); });
  it('accepts a zero-size plaza on any zones', () => { const t = ok(); t.plaza = { x: 0, y: 0, width: 0, height: 0, elevation: 1 }; t.zones[0]![0] = CellZone.Void; expect(validatePlanetTemplate(t)).toBeNull(); });
  it('rejects malformed chunk grids', () => {
    for (const g of ['x', null, { origin: { x: 0, y: 0 }, columns: 1e9, rows: 2 }, { origin: { x: 0, y: 0 }, columns: 0, rows: 2 }, { origin: { x: NaN, y: 0 }, columns: 2, rows: 2 }, { origin: { x: 0, y: 0 }, columns: 2.5, rows: 2 }]) {
      const t = ok(); t.chunkGrid = g as never; expect(validatePlanetTemplate(t)).toBe('size');
    }
    const t = ok(); t.chunkGrid = { origin: { x: -1, y: 0 }, columns: 2, rows: 2 }; expect(validatePlanetTemplate(t)).toBeNull();
  });
  it('rejects a plaza elevation outside the terrain range', () => {
    for (const e of [-1, 1.5, 99, NaN]) { const t = ok(); t.plaza.elevation = e; expect(validatePlanetTemplate(t)).toBe('plaza'); }
  });
  it('rejects ids outside the custom namespace', () => { const t = ok(); t.id = 'hexia'; expect(validatePlanetTemplate(t)).toBe('id'); });
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
