/** Each surface's Smart Build arms one registered macro; network operations remain available to programmatic callers. */
import { describe, expect, it } from 'vitest';
import { MACRO_IDS, SHELF_MACRO_IDS, macroForSurface, macroLabel } from '../../../tools/macros';
import { translations } from '../../../i18n/translations';

const SURFACES = ['mountain', 'water', 'road'] as const;

describe('smart construction', () => {
  it('arms one aimed macro per terrain surface and keeps network operations out of the toolbar', () => {
    expect(SURFACES.map(macroForSurface)).toEqual(['raise', 'stream', 'road-link']);
    for (const id of SURFACES.map(macroForSurface)) expect(MACRO_IDS).toContain(id);
  });

  it('offers each macro on one surface or one shelf card, never both', () => {
    const offered = [...SURFACES.map(macroForSurface), ...SHELF_MACRO_IDS];
    expect(new Set(offered).size).toBe(offered.length);
  });

  /** A macro toasts only an empty report; what a landing macro built is on the map. */
  it('names every offered action, and the empty reports, in all seven locales', () => {
    const offered = [...SURFACES.map(macroForSurface), ...SHELF_MACRO_IDS];
    for (const [locale, table] of Object.entries(translations)) {
      for (const id of offered) {
        const key = macroLabel(id);
        expect(`${locale}:${id}`).toBe(`${locale}:${key !== null && key in table ? id : 'MISSING'}`);
      }
      for (const key of [
        'smart.empty', 'smart.empty_roads', 'smart.terrain_blocked',
        'smart.river_blocked', 'smart.empty_link', 'smart.no_door',
        'smart.roads_settled', 'smart.unrouted', 'smart.blocked',
      ]) {
        expect(`${locale}:${key}`).toBe(`${locale}:${key in table ? key : 'MISSING'}`);
      }
      for (const key of Object.keys(table)) {
        expect(key.startsWith('smart.done_'), `${locale}:${key} is a landing toast`).toBe(false);
      }
    }
  });
});
