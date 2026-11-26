/*
 * Help's copy as plain text, for a reader that takes words instead of the window: each page is its
 * opening, one passage per section and one per question, resolved from the same keys, facts and live
 * keymap the window renders, so the text and the page cannot disagree.
 */
import { translateFor } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import type { TextKey } from '../../i18n/keys';
import { providerName } from '../../i18n/terms/providers';
import { readingKey, type Reading } from '../../i18n/terms/device-readings';
import type { Overrides } from '../../state/keymap/resolve';
import { HELP_PAGES } from './catalog';
import { helpFacts } from './facts';
import { keyRowContext, resolveTokenSpecs, type ResolvedToken } from './key-tokens';
import type { HelpFactsOf, HelpPage, HelpPageId, HelpSection } from './page-schema';
import { WRITTEN, searchHelp, sectionBodyKeys } from './search';

export interface HelpPassage {
  page: HelpPageId;
  /** The section's anchor; absent for the page's opening and for a question. */
  anchor?: string;
  heading: string;
  text: string;
}

/** Who reads: the language, the live keymap and the input form. */
export interface HelpReader {
  locale: Locale;
  /** The facts whose owners rank above this layer; a reader without them reads a string that quotes
   *  one with its `{token}` standing. */
  factsAbove?: HelpFactsOf;
  overrides: Overrides;
  reading?: Reading;
}

/** The most passages one search answers with, and the most it takes from one page. */
export const SEARCH_PASSAGE_CAP = 6;
const PASSAGES_PER_PAGE = 2;

/** Copy without the page's marks: `**bold**` and the `[[name]]` inline art. */
const plain = (text: string): string => text.replace(/\s*\[\[[^\]]*\]\]/g, '').replace(/\*\*/g, '').trim();

/** A key row's tokens in words. The window draws mouse gestures and separators as marks, which have
 *  no copy, so they are named in English. */
function tokenText(tokens: readonly ResolvedToken[]): string {
  return tokens.map((token) => {
    const twice = 'x2' in token && token.x2 ? ' x2' : '';
    if (token.kind === 'cap') return `${token.label}${twice}`;
    if (token.kind === 'pan-stack') return `${token.letters} or the arrow keys`;
    if (token.kind === 'mouse') return `${token.button === 'none' ? 'pointer' : `${token.button} mouse button`}${token.mark ? ` ${token.mark}` : ''}${twice}`;
    return token.sep === 'plus' ? '+' : token.sep === 'or' ? 'or' : 'then again';
  }).join(' ');
}

function sectionText(section: Exclude<HelpSection, { kind: 'callout' }>, reader: HelpReader, say: (key: TextKey) => string): string {
  const lines = (keys: readonly TextKey[] = []): string[] => keys.map(say);
  if (section.kind === 'steps') {
    const t = (key: TextKey): string => translateFor(reader.locale, key);
    return [
      ...lines(section.bodyKeys),
      ...section.groups.flatMap((group) => [`${providerName(group.provider, t)}:`, ...group.stepKeys.map((key) => `- ${say(key)}`)]),
    ].join('\n');
  }
  if (section.kind === 'list') {
    return [...lines(section.bodyKeys), ...section.items.map((item, i) => `${section.ordered ? `${i + 1}.` : '-'} ${say(item.key)}`)].join('\n');
  }
  if (section.kind === 'keys') {
    const rows = section.rows.flatMap((row) => {
      const tokens = resolveTokenSpecs(row.tokens, reader.overrides, keyRowContext(section.anchor));
      return tokens ? [`- ${say(row.doKey)}: ${tokenText(tokens)}`] : [];
    });
    return [...rows, ...lines(section.afterKeys)].join('\n');
  }
  return lines(sectionBodyKeys(section)).join('\n');
}

/** Every passage of `page`, in reading order. A touch reader's page shows no key tables, so neither does its text. */
export function pagePassages(page: HelpPage, reader: HelpReader): HelpPassage[] {
  const reading = reader.reading ?? WRITTEN;
  const say = (key: TextKey): string => plain(translateFor(reader.locale, readingKey(key, reading), helpFacts(reader.locale, reader.factsAbove)));
  const passages: HelpPassage[] = [{ page: page.id, heading: say(page.titleKey), text: `${say(page.ledeKey)}\n${say(page.entryKey)}` }];
  for (const section of page.sections) {
    if (section.kind === 'callout') {
      // An aside has no heading of its own: it reads on from the passage before it.
      passages[passages.length - 1]!.text += `\n${say(section.bodyKey)}`;
      continue;
    }
    if (section.kind === 'keys' && reading.inputMode === 'touch') continue;
    passages.push({ page: page.id, anchor: section.anchor, heading: say(section.titleKey), text: sectionText(section, reader, say) });
  }
  for (const qa of page.qa) passages.push({ page: page.id, heading: say(qa.qKey), text: say(qa.aKey) });
  return passages;
}

/** The anchor of the section holding `anchor`: itself, or the list one of whose items stands there. */
export function sectionAnchorOf(page: HelpPage, anchor: string): string | undefined {
  for (const section of page.sections) {
    if (section.kind === 'callout') continue;
    if (section.anchor === anchor || (section.kind === 'list' && section.items.some((item) => item.anchor === anchor))) return section.anchor;
  }
  return undefined;
}

/**
 * The passages that answer `query`, best page first (`searchHelp`'s order), at most `cap`. A passage
 * matches by its own words or their English twin, as the page search does; a page found only by its
 * title gives its opening.
 */
export function searchPassages(query: string, reader: HelpReader, cap: number = SEARCH_PASSAGE_CAP): HelpPassage[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found: HelpPassage[] = [];
  for (const hit of searchHelp(reader.locale, query, reader.factsAbove, reader.reading)) {
    if (found.length >= cap) break;
    const page = HELP_PAGES[hit.page];
    const own = pagePassages(page, reader);
    const twin = reader.locale === 'en' ? null : pagePassages(page, { ...reader, locale: 'en' });
    const ranked = own
      .map((passage, i) => {
        const words = `${passage.heading}\n${passage.text}\n${twin?.[i]?.heading ?? ''}\n${twin?.[i]?.text ?? ''}`.toLowerCase();
        const matched = terms.filter((term) => words.includes(term)).length;
        // The section the page search found by its heading leads among passages holding as many of the words.
        return { passage, i, score: matched + (matched > 0 && passage.anchor !== undefined && passage.anchor === hit.anchor ? 0.5 : 0) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i);
    const taken = ranked.length > 0 ? ranked.slice(0, PASSAGES_PER_PAGE).map((entry) => entry.passage) : [own[0]!];
    found.push(...taken.slice(0, cap - found.length));
  }
  return found;
}
