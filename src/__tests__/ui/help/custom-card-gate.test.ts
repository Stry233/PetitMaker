import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../platform/build/build-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/build/build-info')>();
  return { ...actual, IS_DEV_BUILD: false };
});

import { HELP_PAGES } from '../../../ui/help/catalog';

const bodyKeys = (id: 'gen-picture' | 'gen-letter' | 'candidates'): string[] =>
  HELP_PAGES[id].sections.flatMap((s) => (s.kind === 'prose' ? [...s.bodyKeys] : []));

describe('help copy for released custom cards', () => {
  it('includes Letter examples, custom text entry and its limit question', () => {
    expect(bodyKeys('gen-letter')).toContain('help.genletter.what_b1');
    expect(bodyKeys('gen-letter')).toContain('help.genletter.custom_b1');
    expect(HELP_PAGES['gen-letter'].qa.map(qa => qa.qKey)).toContain('help.genletter.q1');
  });

  it('drops the local-image sentence and the upload question from the Picture page', () => {
    expect(bodyKeys('gen-picture')).toContain('help.genpicture.what_b1');
    expect(bodyKeys('gen-picture')).not.toContain('help.genpicture.what_b2');
    expect(HELP_PAGES['gen-picture'].qa.map((qa) => qa.qKey)).not.toContain('help.genpicture.q1');
  });

  it('includes custom Letter entry on the recipe-card page', () => {
    expect(bodyKeys('candidates')).toContain('help.candidates.own_b1');
    expect(bodyKeys('candidates')).toContain('help.candidates.own_b2');
  });
});
