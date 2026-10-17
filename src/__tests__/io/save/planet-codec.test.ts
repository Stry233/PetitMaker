import { describe, it, expect } from 'vitest';
import type { MapTemplate } from '../../../core/model/types';
import { ImportError } from '../../../io/save/import-error';
import { clampName, parseTemplate, PLANET_NAME_MAX, readPlanetFile, serializeTemplate, writePlanetFile } from '../../../io/save/planet-codec';
import { NO_PLAZA, planetFixture as planet, pondMask, landmarkAt } from '../../_support/planet';
import { rleDecode, rleEncode } from '../../../io/save/rle';
import { templateAnchor } from '../../../core/model/landmarks';
import { ELEVATION_MAX } from '../../../core/game/profile';

const roundTrip = (t: MapTemplate) => parseTemplate(JSON.parse(JSON.stringify(serializeTemplate(t))));

describe('planet codec', () => {
  it('round-trips a template exactly', () => {
    const t = planet();
    expect(roundTrip(t)).toEqual(t);
  });
  it('round-trips a planet without a plaza', () => {
    const t = planet({ plaza: NO_PLAZA });
    expect(roundTrip(t)).toEqual(t);
  });
  it('round-trips a rotated plaza and omits rotation 0', () => {
    const t = planet({ plaza: landmarkAt(12.5, 3.5, 90) });
    expect(roundTrip(t)).toEqual(t);
    expect(serializeTemplate(planet()).landmarks![0]).not.toHaveProperty('rotation');
  });
  it('round-trips terrain at the highest layer', () => {
    const terrain = new Uint8Array(48 * 32); terrain[10 * 48 + 10] = ELEVATION_MAX;
    const t = planet({ terrain });
    expect(roundTrip(t)).toEqual(t);
  });
  it('round-trips a template with no terrain', () => {
    const t = planet({ terrain: null });
    expect(roundTrip(t)).toEqual(t);
  });
  it('gives all-zero terrain the id of no terrain and omits it', () => {
    const none = planet({ terrain: null, plaza: NO_PLAZA });
    const zero = planet({ terrain: new Uint8Array(48 * 32), plaza: NO_PLAZA });
    expect(zero.id).toBe(none.id);
    expect(serializeTemplate(zero).terrain).toBeUndefined();
    expect(roundTrip(zero).id).toBe(none.id);
  });
  it('round-trips a pond and names the planet with it', () => {
    const t = planet({ water: pondMask([[20, 12], [21, 12]]) });
    expect(roundTrip(t)).toEqual(t);
    expect(t.id).not.toBe(planet().id);
    expect(planet({ water: new Uint8Array(48 * 32) }).id).toBe(planet().id);
  });
  it('drops water on cells that cannot hold it, so the id is that of the planet that loads', () => {
    const pond = planet({ water: pondMask([[20, 12]]) });
    const stray = planet({ water: pondMask([[20, 12], [0, 0], [1, 31]]) });
    expect(stray.id).toBe(pond.id);
    expect(planet({ water: pondMask([[0, 0]]) }).id).toBe(planet().id);
    const raw = { ...serializeTemplate(pond), water: serializeTemplate({ ...pond, water: pondMask([[20, 12], [0, 0]]) }).water };
    expect(parseTemplate(raw)).toEqual(pond);
    expect(parseTemplate({ ...serializeTemplate(planet()), water: serializeTemplate({ ...pond, water: pondMask([[0, 0]]) }).water })).toEqual(planet());
  });
  it('rejects a water token other than 0 or 1', () => {
    const raw = serializeTemplate(planet({ water: pondMask([[20, 12]]) }));
    expect(() => parseTemplate({ ...raw, water: rleEncode(rleDecode(raw.water!).map((v) => (v === '1' ? '2' : v))) })).toThrow(ImportError);
  });
  it('rejects a malformed chunk grid', () => {
    for (const g of [{ origin: { x: 0, y: 0 }, columns: 'x', rows: 2 }, { origin: { x: 0, y: 0 }, columns: 2, rows: null }, { origin: 'x', columns: 2, rows: 2 }, { origin: { x: 0, y: 0 }, columns: 1e9, rows: 2 }, { origin: { x: 0, y: 0 }, columns: -1, rows: 2 }]) {
      const s = { ...serializeTemplate(planet()), chunkGrid: g };
      expect(() => parseTemplate(JSON.parse(JSON.stringify(s)))).toThrow();
    }
    expect(() => parseTemplate({ ...serializeTemplate(planet()), chunkGrid: { origin: { x: NaN, y: 0 }, columns: 2, rows: 2 } })).toThrow();
  });
  it('derives the chunk grid when the value is not an object', () => {
    const t = planet();
    expect(parseTemplate({ ...serializeTemplate(t), chunkGrid: 'x' }).chunkGrid).toEqual(t.chunkGrid);
  });
  it('derives a missing chunk grid', () => {
    const t = planet();
    const { chunkGrid: _drop, ...s } = serializeTemplate(t);
    expect(parseTemplate(s).chunkGrid).toEqual(t.chunkGrid);
  });
  it('treats a non-string name as empty', () => {
    const s = { ...serializeTemplate(planet()), name: 5 };
    expect(parseTemplate(s).name.en).toBe('');
  });
  it('round-trips a planet file', () => {
    const { name, template } = readPlanetFile(writePlanetFile('Bay', planet()));
    expect(name).toBe('Bay');
    expect(template.id).toBe(planet().id);
  });
  it('rejects a file whose id does not match its content', () => {
    const s = serializeTemplate(planet()); s.zones = s.zones.replace('2', '1');
    expect(() => parseTemplate(s)).toThrow();
  });
  it('keeps only the known landmark fields', () => {
    const t = planet();
    const raw = serializeTemplate(t);
    const parsed = parseTemplate({ ...raw, landmarks: raw.landmarks!.map((l) => ({ ...l, color: '#ff0000', locked: false })) });
    expect(templateAnchor(parsed)!).toEqual(templateAnchor(t)!);
    expect(Object.keys(templateAnchor(parsed)!).sort()).toEqual(['height', 'id', 'width', 'x', 'y']);
  });
  it.each([['259'], [String(ELEVATION_MAX + 1)], ['-1'], ['abc'], ['3.0'], ['']])('rejects the terrain token %j', (token) => {
    const raw = serializeTemplate(planet());
    const tokens = rleDecode(raw.terrain!);
    tokens[10 * 48 + 10] = token;
    expect(() => parseTemplate({ ...raw, terrain: rleEncode(tokens) })).toThrow(ImportError);
  });
  it.each([['2.0'], ['abc'], ['']])('rejects the zone token %j', (token) => {
    const raw = serializeTemplate(planet());
    const tokens = rleDecode(raw.zones);
    const at = tokens.indexOf('2');
    tokens[at] = token;
    expect(() => parseTemplate({ ...raw, zones: rleEncode(tokens) })).toThrow(ImportError);
  });
  it('rejects malformed run data', () => {
    const s = serializeTemplate(planet()); s.zones = '99999*0';
    expect(() => parseTemplate(s)).toThrow();
  });
  it('clamps a name to the limit without splitting a surrogate pair', () => {
    const star = '\u{1F31F}';
    expect(clampName('a'.repeat(PLANET_NAME_MAX + 3))).toHaveLength(PLANET_NAME_MAX);
    expect(clampName('a'.repeat(PLANET_NAME_MAX - 1) + star)).toBe('a'.repeat(PLANET_NAME_MAX - 1));
    expect(clampName('a'.repeat(PLANET_NAME_MAX - 2) + star)).toBe('a'.repeat(PLANET_NAME_MAX - 2) + star);
  });
  it('writes a planet file under the clamped name', () => {
    const star = '\u{1F31F}';
    expect(readPlanetFile(writePlanetFile('a'.repeat(PLANET_NAME_MAX - 1) + star, planet())).name).toBe('a'.repeat(PLANET_NAME_MAX - 1));
  });
  it('rejects non-planet JSON', () => {
    expect(() => readPlanetFile('{"format":"other"}')).toThrow();
    expect(() => readPlanetFile('not json')).toThrow();
  });
});
