import { describe, expect, it } from 'vitest';
import { HELP_TABLES } from '../../_support/locale-tables';
import { helpFacts } from '../../../editor/help/facts';
import { RECIPE_RANGES, STENCIL_MIN_SIDE } from '../../../tools/generation/facts';
import type { Locale } from '../../../core/model/locale';

const LOCALES = Object.keys(HELP_TABLES) as Locale[];

/** Each Help key quotes these facts, so its copy must carry the token rather than a typed number. */
const TOKENS: Record<string, readonly string[]> = {
  'help.genpicture.room_b1': ['pictureMinSide'],
  'help.genletter.room_b1': ['letterMinSide'],
  'help.region.done_b1': ['letterMinSide', 'pictureMinSide'],
  'help.genletter.custom_b1': ['letterMaxChars'],
  'help.genletter.a1': ['letterMaxChars'],
};

describe('help facts read from the code', () => {
  it('derive the stencil floors and the text limit from their constants', () => {
    for (const locale of LOCALES) {
      expect(helpFacts(locale)).toMatchObject({
        pictureMinSide: STENCIL_MIN_SIDE.image,
        letterMinSide: STENCIL_MIN_SIDE.text,
        letterMaxChars: RECIPE_RANGES.textChars.max,
      });
    }
  });

  it('quote those facts through tokens in every locale', () => {
    for (const locale of LOCALES) {
      for (const [key, tokens] of Object.entries(TOKENS)) {
        const copy = HELP_TABLES[locale][key];
        for (const token of tokens) expect(copy, `${locale} ${key}`).toContain(`{${token}}`);
      }
    }
  });
});
