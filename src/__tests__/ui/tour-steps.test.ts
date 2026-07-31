import { describe, it, expect } from 'vitest';
import { planRun, TOUR_STEPS, tourTargetAttr } from '../../ui/chrome/tour/steps';
import { translations } from '../../i18n/translations';

describe('tour steps', () => {
  it('has seven steps in a fixed order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'welcome', 'camera', 'open', 'menu', 'collapse', 'layers', 'view',
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

  it('opens the phone card on the step that explains it, and closes it one step after the pill', () => {
    // The collapse rides `layers`, not `collapse`: collapsing on entry to `collapse` would pull the
    // home pill out from under its own spotlight. Nothing closes the card on the way IN, because a
    // replay is started from the Settings gear on the expanded card and closing it would undo the
    // visitor's own gesture; that run drops the step instead (see the plan below).
    expect(TOUR_STEPS.filter((s) => s.menu).map((s) => [s.id, s.menu])).toEqual([
      ['menu', 'expand'],
      ['layers', 'collapse'],
    ]);
  });

  it('leaves out the step that teaches opening the card when the card is already open', () => {
    // A precondition, not a mid-run skip: the run is planned as it starts, so the counter numbers
    // the tour actually being given rather than showing a gap where a step was passed over.
    expect(planRun({ menuOpen: false }).map((s) => s.id)).toEqual(TOUR_STEPS.map((s) => s.id));
    expect(planRun({ menuOpen: true }).map((s) => s.id)).toEqual([
      'welcome', 'camera', 'menu', 'collapse', 'layers', 'view',
    ]);
    expect(TOUR_STEPS.filter((s) => s.skipWhen).map((s) => [s.id, s.skipWhen])).toEqual([
      ['open', 'menu-open'],
    ]);
  });

  it('points at the collapsed phone before anything opens it', () => {
    // The app opens collapsed, so the card expanding on the NEXT step is something the visitor was
    // told about rather than the app moving on its own.
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(TOUR_STEPS.find((s) => s.id === 'open')?.target).toBe('menu-collapsed');
    expect(ids.indexOf('open')).toBeLessThan(ids.indexOf('menu'));
  });

  it('lets the real gesture stand in for Next on the two steps that describe one', () => {
    // Both point at a live control the dim does not cover, so doing the thing the step describes
    // has to count. Every other step is read-and-advance and names no condition.
    expect(TOUR_STEPS.filter((s) => s.advanceWhen).map((s) => [s.id, s.advanceWhen])).toEqual([
      ['open', 'menu-open'],
      ['collapse', 'menu-closed'],
    ]);
  });

  it('shows the brand on the welcome step only', () => {
    expect(TOUR_STEPS.filter((s) => s.brand).map((s) => s.id)).toEqual(['welcome']);
  });

  it('spreads as a data attribute', () => {
    expect(tourTargetAttr('menu-tiles')).toEqual({ 'data-tour-target': 'menu-tiles' });
  });
});
