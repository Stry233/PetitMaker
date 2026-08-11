// The tour's step list as DATA: what it says, and that no two steps ask for the same spotlight.
// How a run behaves over the live interface is `ui/shell/tour.test.tsx`.
import { describe, it, expect } from 'vitest';
import { tourTargetAttr } from '../../../ui/chrome/tour/steps';
import { SHELL_TOUR_STEPS as TOUR_STEPS } from '../../../ui/shell/tour-steps';
import { translations } from '../../../i18n/translations';

describe('tour steps', () => {
  it('has seven steps in a fixed order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'welcome', 'camera', 'modes', 'bar', 'assistant', 'share', 'menu',
    ]);
  });

  it('every title and body key exists in every locale', () => {
    for (const [locale, table] of Object.entries(translations)) {
      for (const step of TOUR_STEPS) {
        expect(table[step.titleKey], `${locale} ${step.titleKey}`).toBeTruthy();
        expect(table[step.bodyKey], `${locale} ${step.bodyKey}`).toBeTruthy();
      }
    }
  });

  it('carries no em dash in any locale (they crowd the compact panels)', () => {
    for (const table of Object.values(translations)) {
      for (const step of TOUR_STEPS) {
        expect(table[step.titleKey]).not.toContain('—');
        expect(table[step.bodyKey]).not.toContain('—');
      }
    }
  });

  it('names each target once, so a spotlight can never be ambiguous', () => {
    const targets = TOUR_STEPS.map((s) => s.target).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('leaves the two steps about the map as a whole targetless, so nothing spotlights the viewport', () => {
    // The map fills the screen, so pointing at it would put the lit hole over everything and the
    // bubble past the edge. Those steps dim the whole app and centre their bubble instead.
    expect(TOUR_STEPS.filter((s) => !s.target).map((s) => s.id)).toEqual(['welcome', 'camera']);
  });

  it('selects a mode for the step about the tools, and clears it on the last one', () => {
    // The bottom bar belongs to the selected mode, so the step about it has nothing to point at
    // until one is on; clearing it on the way out ends the run with the interface at rest.
    expect(TOUR_STEPS.filter((s) => s.mode !== undefined).map((s) => [s.id, s.mode])).toEqual([
      ['bar', 'mountain'],
      ['menu', null],
    ]);
  });

  it('shows the brand on the welcome step only', () => {
    expect(TOUR_STEPS.filter((s) => s.brand).map((s) => s.id)).toEqual(['welcome']);
  });

  it('spreads as a data attribute', () => {
    expect(tourTargetAttr('bar')).toEqual({ 'data-tour-target': 'bar' });
  });
});
