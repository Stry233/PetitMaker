import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../state/catalog', async (original) => {
  const catalog = await original<typeof import('../../../state/catalog')>();
  for (const item of catalog.getAllItems()) {
    if (item.category !== 'ramp') continue;
    item.height = 3;
    const drop = item.traits.find(trait => trait.type === 'heightDrop');
    if (drop?.type === 'heightDrop') drop.layers = 2;
  }
  return catalog;
});

import { HELP_TABLES } from '../../_support/locale-tables';
import { helpFacts } from '../../../ui/help/facts';
import type { Locale } from '../../../core/model/locale';

describe('ramp help dimensions', () => {
  it('follows catalog changes and supplies the same measurements to every translation', () => {
    for (const locale of Object.keys(HELP_TABLES) as Locale[]) {
      expect(helpFacts(locale)).toMatchObject({
        rampRun: 3, rampLowerRun: 2.5, rampUpperRun: 0.5, rampDrop: 2,
      });
      const table = HELP_TABLES[locale];
      for (const token of ['rampRun', 'rampLowerRun', 'rampUpperRun', 'rampDrop']) {
        expect(table['help.objects.ramp_b1']).toContain(`{${token}}`);
      }
      expect(table['help.fig.ramp_1']).toContain('{rampDrop}');
      expect(table['help.faq.span_b1']).toContain('{rampDrop}');
    }
  });
});
