import { describe, it, expect } from 'vitest';
import { getMapTemplate, DEFAULT_MAP } from '../../config/maps';
import { mapChunkAxes } from '../../core/model/map-chunks';
import { PLANET_PROFILE } from '../../core/model/game-profile';

describe('getMapTemplate', () => {
  it('resolves a registered id to its own template', () => {
    expect(getMapTemplate('tafa').id).toBe('tafa');
  });

  it('falls back to the default for an Object.prototype key', () => {
    expect(getMapTemplate('__proto__')).toBe(DEFAULT_MAP);
    expect(getMapTemplate('toString')).toBe(DEFAULT_MAP);
    expect(getMapTemplate('constructor')).toBe(DEFAULT_MAP);
  });

  it.each(['hexia', 'tafa'])('%s retains its reference chunk borders within the cropped map', (id) => {
    const template = getMapTemplate(id);
    const { columns, rows } = mapChunkAxes(template);
    expect([template.width, template.height]).toEqual([169, 140]);
    expect(columns).toHaveLength(13);
    expect(rows).toHaveLength(12);
    expect(columns.map((span) => span.start).filter((x) => x > 0 && x < template.width)).toEqual([1, 17, 33, 49, 65, 81, 97, 113, 129, 145, 161]);
    expect(rows.map((span) => span.start).filter((y) => y > 0 && y < template.height)).toEqual([9, 25, 41, 57, 73, 89, 105, 121, 137]);
  });

  it.each(['hexia', 'tafa'])('%s lays the landmark the planet profile gives custom planets', (id) => {
    const { width, height, elevation } = getMapTemplate(id).plaza;
    expect({ width, height, elevation }).toEqual(PLANET_PROFILE.landmark);
  });
});
