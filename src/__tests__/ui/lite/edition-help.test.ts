import { describe, expect, it, vi } from 'vitest';
// The build defines the edition flag; unset under test, so it is set before the edition module loads.
vi.hoisted(() => { (globalThis as { __PETIT_LITE__?: boolean }).__PETIT_LITE__ = true; });
// The offline build aliases the edition's Help module to its own (`scripts/edition-build.mts`).
vi.mock('../../../ui/help/edition-help', () => import('../../../ui/lite/edition-help'));
import { HELP_GROUPS, HELP_PAGES, HELP_PAGE_ORDER } from '../../../ui/help/catalog';
import { shellTourSteps } from '../../../ui/shell/tour/tour-steps';
import { TABS } from '../../../ui/shell/bars/generate/generate-shelf';
import { START_PAGES } from '../../../ui/help/pages/start';
import { BUILD_PAGES } from '../../../ui/help/pages/build';
import { GENERATE_PAGES } from '../../../ui/help/pages/generate';
import { PLAN_PAGES } from '../../../ui/help/pages/plan';
import { SHARE_PAGES } from '../../../ui/help/pages/share';
import { MISC_PAGES } from '../../../ui/help/pages/misc';

/** Every string key a record names, at any depth. */
function keysOf(value: unknown): string[] {
  if (typeof value === 'string') return /^[a-z]+\.[\w.]+$/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(keysOf);
  return [];
}

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

  /** A Lite variant says the same thing as its entry, shorter, or in copy written for Lite: it never
   *  borrows another entry's paragraph, whose meaning drifts when that entry is edited. */
  it('replaces copy only with the entry\'s own keys or copy written for Lite', () => {
    const borrowed: string[] = [];
    const visit = (record: { lite?: unknown }) => {
      if (!record.lite || typeof record.lite !== 'object') return;
      const own = new Set(keysOf({ ...record, lite: undefined }));
      for (const key of keysOf(record.lite)) {
        if (!own.has(key) && !key.startsWith('lite.') && !key.endsWith('_lite') && !key.endsWith('.figcap')) borrowed.push(key);
      }
    };
    for (const page of [...START_PAGES, ...BUILD_PAGES, ...GENERATE_PAGES, ...PLAN_PAGES, ...SHARE_PAGES, ...MISC_PAGES]) {
      for (const section of page.sections) {
        visit(section);
        if (section.kind === 'keys') section.rows.forEach(visit);
      }
      page.qa.forEach(visit);
    }
    expect(borrowed).toEqual([]);
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
