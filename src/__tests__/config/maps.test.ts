import { describe, it, expect } from 'vitest';
import { getMapTemplate, DEFAULT_MAP } from '../../config/maps';

describe('getMapTemplate', () => {
  it('resolves a registered id to its own template', () => {
    expect(getMapTemplate('tafa').id).toBe('tafa');
  });

  it('falls back to the default for an Object.prototype key', () => {
    expect(getMapTemplate('__proto__')).toBe(DEFAULT_MAP);
    expect(getMapTemplate('toString')).toBe(DEFAULT_MAP);
    expect(getMapTemplate('constructor')).toBe(DEFAULT_MAP);
  });
});
