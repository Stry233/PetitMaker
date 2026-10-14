/**
 * Every tool the agent can call has a name a person would use for it, in every locale: a tool
 * shipped without its `agent.verb_<tool>` phrase would render its wire name in the panel.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_NAMES, toolVerbKey } from '../../agent/panel';
import { translations } from '../_support/locale-tables';
import type { Locale } from '../../core/model/locale';

describe('the op row names every tool the agent has', () => {
  it('gives every one of them a phrase in all seven locales', () => {
    const locales = Object.keys(translations) as Locale[];
    for (const name of TOOL_NAMES) {
      for (const loc of locales) {
        const key = toolVerbKey(name);
        expect(translations[loc][key], `${loc}/${name} (${key})`).toBeTruthy();
      }
    }
  });

  it('names an unknown tool as a generic operation', () => {
    expect(toolVerbKey('retired_tool')).toBe('agent.verb_operation');
  });
});
