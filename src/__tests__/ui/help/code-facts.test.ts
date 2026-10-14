import { describe, expect, it } from 'vitest';
import { HELP_TABLES } from '../../_support/locale-tables';
import { helpFacts } from '../../../ui/help/facts';
import { fillKindsFor, fillLabelKey, STENCIL_MIN_SIDE, TEXT_MAX_CHARS } from '../../../ui/shell/bars/generate/generate-shelf';
import { MAX_TURN_ATTEMPTS } from '../../../agent/core/retry';
import { BETWEEN_EVENT_IDLE_MS, FIRST_EVENT_IDLE_MS } from '../../../agent/core/stream-idle';
import type { Locale } from '../../../core/model/locale';

const LOCALES = Object.keys(HELP_TABLES) as Locale[];

/** Each Help key quotes these facts, so its copy must carry the token rather than a typed number. */
const TOKENS: Record<string, readonly string[]> = {
  'help.genpicture.room_b1': ['pictureMinSide'],
  'help.genletter.room_b1': ['letterMinSide'],
  'help.region.done_b1': ['letterMinSide', 'pictureMinSide'],
  'help.genletter.custom_b1': ['letterMaxChars'],
  'help.genletter.a1': ['letterMaxChars'],
  'help.agenttrouble.waiting_b1': ['agentFirstWaitMinutes', 'agentBetweenWaitMinutes', 'agentTries'],
};

describe('help facts read from the code', () => {
  it('derive the stencil floors, the text limit and the assistant waits and tries from their constants', () => {
    for (const locale of LOCALES) {
      expect(helpFacts(locale)).toMatchObject({
        pictureMinSide: STENCIL_MIN_SIDE.image,
        letterMinSide: STENCIL_MIN_SIDE.text,
        letterMaxChars: TEXT_MAX_CHARS,
        agentTries: MAX_TURN_ATTEMPTS,
        agentFirstWaitMinutes: FIRST_EVENT_IDLE_MS / 60_000,
        agentBetweenWaitMinutes: BETWEEN_EVENT_IDLE_MS / 60_000,
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

  it('name every Letter material on the materials section in every locale', () => {
    for (const locale of LOCALES) {
      const copy = HELP_TABLES[locale]['help.genletter.material_b1'];
      for (const fill of fillKindsFor('text')) {
        const key = fillLabelKey('text', fill);
        expect(copy, `${locale} ${fill}`).toContain(`{ui:${key}}`);
      }
    }
  });
});
