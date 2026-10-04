import { describe, expect, it, vi } from 'vitest';
// The build defines the edition flag; unset under test, so it is set before the edition module loads.
vi.hoisted(() => { (globalThis as { __PETIT_LITE__?: boolean }).__PETIT_LITE__ = true; });
import { HELP_GROUPS, HELP_PAGES, HELP_PAGE_ORDER } from '../../../ui/chrome/modals/help/catalog';
import { shellTourSteps } from '../../../ui/shell/tour-steps';
import { TABS } from '../../../ui/shell/bars/generate-shelf';

describe('Lite help and tour', () => {
  it('documents available features with reachable related pages', () => {
    expect(HELP_GROUPS).not.toContain('agent');
    expect(HELP_PAGE_ORDER).toEqual(expect.arrayContaining(['welcome', 'tour', 'terrain', 'objects', 'gen-island', 'maze', 'share', 'save']));
    for (const id of ['json', 'gen-letter', 'gen-picture']) expect(HELP_PAGE_ORDER).not.toContain(id);
    for (const id of HELP_PAGE_ORDER) {
      const page = HELP_PAGES[id];
      expect(page.sections.some(section => section.kind === 'steps')).toBe(false);
      for (const related of page.seeAlso) expect(HELP_PAGES[related]).toBeDefined();
    }
    expect(HELP_PAGES.share.ledeKey).toBe('lite.save_hint');
    expect(HELP_PAGES.share).toMatchObject({ titleKey: 'share.title', navKey: 'share.title' });
    expect(HELP_PAGES.welcome.figure).toEqual({ kind: 'surface', surface: 'frame-overview', captionKey: 'help.frame.figcap' });
    expect(HELP_PAGES.generate.figure).toBeUndefined();
    for (const id of HELP_PAGE_ORDER) expect(HELP_PAGES[id]).not.toHaveProperty('lite');
    expect(HELP_PAGES.share.sections.some(section => section.kind === 'keys' && section.rows.some(row => row.doKey === 'help.share.key_json'))).toBe(false);
  });

  it('returns to 2D before sharing and skips unavailable tour targets', () => {
    const steps = shellTourSteps(true);
    expect(steps.map(step => step.id)).toEqual(['welcome', 'camera', 'modes', 'bar', 'view3d', 'orbit', 'build3d', 'share', 'menu']);
    expect(steps.find(step => step.id === 'share')).toMatchObject({ view: '2d', bodyKey: 'lite.save_hint' });
    expect(shellTourSteps(false).map(step => step.id)).toEqual(['welcome', 'camera', 'modes', 'bar', 'share', 'menu']);
    expect(steps.find(step => step.id === 'menu')).toMatchObject({ bodyKey: 'lite.tour_menu' });
    for (const step of steps) expect(step).not.toHaveProperty('needsWebGL2');
  });

  it('offers the island and maze generators only', () => {
    expect(TABS.map(tab => tab.id)).toEqual(['maze', 'island']);
  });
});
