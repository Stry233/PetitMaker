/** What the tests of Help's facts share: stand-in values for those a frame adds, and how copy is read
 *  for the numbers it types. */
import { LOCALES, type Locale } from '../../core/model/locale';
import type { HelpFactsOf } from '../../editor/help/page-schema';
import { HELP_TABLES } from './locale-tables';

/** The values a reader above `editor` adds, as stand-ins no source declares. */
export const STAND_IN_FACTS_ABOVE: HelpFactsOf = () => ({
  agentMaxTurns: 41, agentChildTurns: 13, agentTries: 7, agentFirstWaitMinutes: 6, agentBetweenWaitMinutes: 4,
  agentProviderCount: 2, agentProviders: 'One and Two', regionalAgentProviders: 'Two',
  richShots: '21, 61 and 99', tallShotLayers: 'I, II and III', contrastShots: '61%, 131% and 221%', reliefShotLayers: 'IV, V and VI',
});

/** A number standing on its own: not part of a word (2D), a target (`[[...]]`) or a token. */
const NUMBER = /(?<![\w.,#[-])\d+(?:[.,]\d+)?(?![\w\]])/g;
const prose = (text: string) => text.replace(/\{\w+\}/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ');
export const numbersIn = (text: string): string[] => prose(text).match(NUMBER) ?? [];

/** Each translation that types the value of one of `facts` where its English quotes the token. */
export function typedFactValues(facts: (locale: Locale) => Readonly<Record<string, string | number>>): string[] {
  const typed: string[] = [];
  for (const locale of LOCALES) {
    const values = facts(locale);
    for (const [key, en] of Object.entries(HELP_TABLES.en)) {
      const text = HELP_TABLES[locale][key] ?? '';
      const numbers = numbersIn(text);
      for (const [, token] of en.matchAll(/\{(\w+)\}/g)) {
        const value = values[token!];
        if (value === undefined || text.includes(`{${token}}`)) continue;
        if (numbers.includes(String(value))) typed.push(`${locale} ${key}: {${token}}`);
      }
    }
  }
  return typed;
}
