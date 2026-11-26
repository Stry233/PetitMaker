/** How the shelf shows each generation kind: a tab, an object material and a Help page that exist. */
import { describe, expect, it } from 'vitest';
import { GENERATE_KIND, type GenerateKind } from '../../../../../ui/shell/bars/generate/generate-shelf';
import { HELP_PAGES } from '../../../../../editor/help/catalog';
import { translations } from '../../../../../i18n/translations';

const KINDS = Object.keys(GENERATE_KIND) as GenerateKind[];

describe('generation kinds on the shelf', () => {
  it('name a tab, a Help page and an object material that exist', () => {
    for (const kind of KINDS) {
      const traits = GENERATE_KIND[kind];
      expect(translations.en[traits.labelKey], kind).toBeTruthy();
      expect(translations.en[traits.objectFillKey], kind).toBeTruthy();
      expect(HELP_PAGES[traits.helpPage], kind).toBeTruthy();
    }
  });
});
