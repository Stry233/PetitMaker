import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../core/runtime/edition', () => ({ IS_LITE: true }));
import { HELP_GROUPS, HELP_PAGES, HELP_PAGE_ORDER } from '../../../ui/chrome/modals/help/catalog';
import { shellTourSteps } from '../../../ui/shell/tour-steps';

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
    expect(HELP_PAGES.share.sections.some(section => section.kind === 'keys' && section.rows.some(row => row.doKey === 'help.share.key_json'))).toBe(false);
  });

  it('returns to 2D before sharing and skips unavailable tour targets', () => {
    const steps = shellTourSteps(true);
    expect(steps.map(step => step.id)).toEqual(['welcome', 'camera', 'modes', 'bar', 'view3d', 'orbit', 'build3d', 'share', 'menu']);
    expect(steps.find(step => step.id === 'share')).toMatchObject({ view: '2d', bodyKey: 'lite.save_hint' });
    expect(shellTourSteps(false).map(step => step.id)).toEqual(['welcome', 'camera', 'modes', 'bar', 'share', 'menu']);
  });
});
