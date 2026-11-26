import { describe, expect, it } from 'vitest';
import { typedFactValues } from '../../_support/help-facts';
import { HELP_TABLES } from '../../_support/locale-tables';
import { helpFactsAbove } from '../../../ui/help/facts';
import { fillKindsFor, fillLabelKey } from '../../../ui/shell/bars/generate/generate-shelf';
import { MAX_TURN_ATTEMPTS } from '../../../agent/core/retry';
import { BETWEEN_EVENT_IDLE_MS, FIRST_EVENT_IDLE_MS } from '../../../agent/core/stream-idle';
import type { Locale } from '../../../core/model/locale';

const LOCALES = Object.keys(HELP_TABLES) as Locale[];

/** The Help key quotes these facts, so its copy must carry the token rather than a typed number. */
const WAITING_TOKENS = ['agentFirstWaitMinutes', 'agentBetweenWaitMinutes', 'agentTries'];

describe('help facts read from the code above the commands', () => {
  it('derive the assistant waits and tries from their constants', () => {
    for (const locale of LOCALES) {
      expect(helpFactsAbove(locale)).toMatchObject({
        agentTries: MAX_TURN_ATTEMPTS,
        agentFirstWaitMinutes: FIRST_EVENT_IDLE_MS / 60_000,
        agentBetweenWaitMinutes: BETWEEN_EVENT_IDLE_MS / 60_000,
      });
    }
  });

  it('quote those facts through tokens in every locale', () => {
    for (const locale of LOCALES) {
      const copy = HELP_TABLES[locale]['help.agenttrouble.waiting_b1'];
      for (const token of WAITING_TOKENS) expect(copy, locale).toContain(`{${token}}`);
    }
  });

  it('never types in a translation the value of a fact its English quotes through a token', () => {
    expect(typedFactValues(helpFactsAbove)).toEqual([]);
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
