/*
 * A released build withholds the Letter and Picture own cards, so the Help Center it ships must not
 * describe them: no local-image sentence or upload question on the Picture page, no text sentence
 * on the recipe-card page. The development catalog, which carries every string, is pinned in
 * `catalog.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../version')>();
  return { ...actual, IS_DEV_BUILD: false };
});

import { HELP_PAGES } from '../../../ui/chrome/modals/help/catalog';

const bodyKeys = (id: 'gen-picture' | 'candidates'): string[] =>
  HELP_PAGES[id].sections.flatMap((s) => (s.kind === 'prose' ? [...s.bodyKeys] : []));

describe('help copy for the own cards a release withholds', () => {
  it('drops the local-image sentence and the upload question from the Picture page', () => {
    expect(bodyKeys('gen-picture')).toContain('help.genpicture.what_b1');
    expect(bodyKeys('gen-picture')).not.toContain('help.genpicture.what_b2');
    expect(HELP_PAGES['gen-picture'].qa.map((qa) => qa.qKey)).not.toContain('help.genpicture.q1');
  });

  it('drops the Letter sentence from the recipe-card page and keeps the card itself', () => {
    expect(bodyKeys('candidates')).toContain('help.candidates.own_b1');
    expect(bodyKeys('candidates')).not.toContain('help.candidates.own_b2');
  });
});
