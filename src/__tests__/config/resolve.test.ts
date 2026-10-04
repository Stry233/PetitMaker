import { describe, it, expect } from 'vitest';
import { DEFAULT_MAP } from '../../config/maps';
import { resolveTemplate, UnknownTemplateError } from '../../config/maps/resolve';

describe('resolveTemplate', () => {
  it('returns built-ins by id', () => { expect(resolveTemplate('tafa').id).toBe('tafa'); });
  it('refuses an unknown id instead of falling back', () => { expect(() => resolveTemplate('custom-deadbeef')).toThrow(UnknownTemplateError); });
  it('opens a missing id on the default map', () => { expect(resolveTemplate(undefined)).toBe(DEFAULT_MAP); });
  it('returns the embedded planet the id names', () => {
    const planet = { ...DEFAULT_MAP, id: 'custom-x' };
    expect(resolveTemplate('custom-x', planet)).toBe(planet);
  });
  it('opens an empty id on the default map', () => { expect(resolveTemplate('')).toBe(DEFAULT_MAP); });
});
