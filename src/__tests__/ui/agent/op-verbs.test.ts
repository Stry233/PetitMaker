/**
 * Every tool the agent can call has a name a person would use for it.
 *
 * `tool-meta.ts`'s `TOOL_META` turns a wire name into a glyph and a present-participle phrase, and its
 * fallback is the RAW NAME — legible, but it is `sculpt_terrace` in a panel whose every other line
 * is a sentence. That fallback exists for a tool a stale saved session mentions, not for one this
 * build ships: a tool added to `TOOL_SCHEMAS` without an entry here renders its wire name in the
 * product, quietly, and nothing else would say so.
 *
 * Held BOTH ways. A missing entry is the defect above; an extra one is a phrase and an icon (and
 * seven translations) kept alive for a tool that no longer exists.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_META } from '../../../ui/agent/tool-meta';
import { TOOL_SCHEMAS } from '../../../agent/tools/tools';
import { translations } from '../../../i18n/translations';
import type { Locale } from '../../../core/model/types';

const toolNames = TOOL_SCHEMAS.map((t) => t.name).sort();
const metaNames = Object.keys(TOOL_META).sort();

describe('the op row names every tool the agent has', () => {
  it('covers the tool surface exactly, with nothing left over', () => {
    const missing = toolNames.filter((n) => !(n in TOOL_META));
    const extra = metaNames.filter((n) => !toolNames.includes(n));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('gives every one of them a phrase in all seven locales', () => {
    const locales = Object.keys(translations) as Locale[];
    for (const [name, meta] of Object.entries(TOOL_META)) {
      for (const loc of locales) {
        const phrase = translations[loc][meta.verbKey];
        expect(phrase, `${loc}/${name} (${meta.verbKey})`).toBeTruthy();
      }
    }
  });
});
