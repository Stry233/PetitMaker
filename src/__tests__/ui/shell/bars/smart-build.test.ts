/** Surface actions use registered macros; network operations remain available to programmatic callers. */
import { describe, expect, it } from 'vitest';
import { MACRO_IDS, type MacroId } from '../../../../tools/macros';
import { SMART_MENU } from '../../../../ui/shell/bars/smart-menu';
import { translations } from '../../../../i18n/translations';

const offered = (): MacroId[] => Object.values(SMART_MENU).flat().map((a) => a.id);

describe('smart construction', () => {
  it('offers one aimed action per terrain surface and keeps network operations out of the toolbar', () => {
    expect(SMART_MENU.mountain.map(a => a.id)).toEqual(['raise']);
    expect(SMART_MENU.water.map(a => a.id)).toEqual(['stream']);
    expect(SMART_MENU.road.map(a => a.id)).toEqual(['road-link']);
    for (const id of offered()) expect(MACRO_IDS).toContain(id);
  });

  /**
   * An entry under a surface whose bar has no control would be drawn by nobody. The controls are
   * pressed in `terrain-bar.slow.test.tsx` and `object-shelf.test.tsx`.
   */
  it('offers macros only on the surfaces whose bars draw the control', () => {
    expect(Object.keys(SMART_MENU).sort()).toEqual(['mountain', 'object', 'road', 'water']);
  });

  it('offers each of them exactly once', () => {
    const seen = offered();
    expect(new Set(seen).size).toBe(seen.length);
  });

  /** A macro toasts only an empty report; what a landing macro built is on the map. */
  it('names every action, and the empty reports, in all seven locales', () => {
    for (const [locale, table] of Object.entries(translations)) {
      for (const action of Object.values(SMART_MENU).flat()) {
        expect(`${locale}:${action.labelKey}`).toBe(`${locale}:${action.labelKey in table ? action.labelKey : 'MISSING'}`);
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
