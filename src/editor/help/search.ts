/*
 * The Help Center's index, built from the descriptors' resolved strings.
 *
 * Indexing the same keys the pages render (title, headings, bodies, Q&A) in the active locale and
 * English is what makes the search a view of the docs rather than a second copy of them, and it is
 * the catalog search's own bilingual habit. Each key is indexed as the reader's input mode and
 * layout shape read it (`device-readings.ts`), so a search finds the wording the page shows. Ranking reuses `state/fuzzy` so a typo tolerated
 * by the item search is tolerated here too.
 */
import { fuzzyScore } from '../../state/fuzzy';
import { translateFor } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { HELP_PAGES, HELP_PAGE_ORDER } from './catalog';
import { helpFacts } from './facts';
import type { HelpFactsOf, HelpPageId, HelpSection } from './page-schema';
import type { TextKey } from '../../i18n/keys';
import { readingKey, type Reading } from '../../i18n/terms/device-readings';

export interface HelpHit {
  page: HelpPageId;
  /** The matching section's anchor, when a heading (rather than only the body) matched. */
  anchor?: string;
  /** What the dropdown quotes under the title: the matched heading, else the page's lede. */
  snippet: string;
}

interface Entry {
  page: HelpPageId;
  title: string;
  lede: string;
  heads: { anchor: string; text: string }[];
  body: string;
}

/** A mouse in the wide arrangement, the reading every key is written for. */
export const WRITTEN: Reading = { inputMode: 'pc', shape: 'landscape' };

/** The copy keys under a section's heading, in the order the page shows them. */
export function sectionBodyKeys(s: Exclude<HelpSection, { kind: 'callout' }>): TextKey[] {
  if (s.kind === 'prose') return [...s.bodyKeys];
  if (s.kind === 'list') return [...(s.bodyKeys ?? []), ...s.items.map((item) => item.key)];
  if (s.kind === 'steps') return [...(s.bodyKeys ?? []), ...s.groups.flatMap((g) => g.stepKeys)];
  return [...s.rows.map((r) => r.doKey), ...(s.afterKeys ?? [])];
}

function buildIndex(locale: Locale, above: HelpFactsOf | undefined, reading: Reading): Entry[] {
  const resolveAll = (key: TextKey): string => {
    const read = readingKey(key, reading);
    const own = translateFor(locale, read, helpFacts(locale, above));
    if (locale === 'en') return own;
    return `${own} ${translateFor('en', read, helpFacts('en', above))}`;
  };
  const shown = (key: TextKey): string => translateFor(locale, readingKey(key, reading), helpFacts(locale, above));
  return HELP_PAGE_ORDER.map((id) => {
    const page = HELP_PAGES[id];
    const heads: Entry['heads'] = [];
    const body: string[] = [resolveAll(page.ledeKey), resolveAll(page.entryKey)];
    for (const s of page.sections) {
      if (s.kind === 'callout') { body.push(resolveAll(s.bodyKey)); continue; }
      // Display text stays in the reader's locale; the search blob carries the English twin too.
      heads.push({ anchor: s.anchor, text: shown(s.titleKey) });
      body.push(resolveAll(s.titleKey));
      for (const k of sectionBodyKeys(s)) body.push(resolveAll(k));
    }
    for (const qa of page.qa) { body.push(resolveAll(qa.qKey)); body.push(resolveAll(qa.aKey)); }
    return {
      page: id,
      title: resolveAll(page.titleKey),
      lede: shown(page.ledeKey),
      heads,
      body: body.join(' ').toLowerCase(),
    };
  });
}

let indexed: { locale: Locale; reading: string; above: HelpFactsOf | undefined; entries: Entry[] } | null = null;

/** The pages matching `query`, searched as a reader in `reading` sees them, best first; `above` fills
 *  the `{token}` params this layer cannot (`facts.ts:helpFacts`). */
export function searchHelp(locale: Locale, query: string, above?: HelpFactsOf, reading: Reading = WRITTEN): HelpHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const read = `${reading.inputMode}/${reading.shape}`;
  if (!indexed || indexed.locale !== locale || indexed.reading !== read || indexed.above !== above) {
    indexed = { locale, reading: read, above, entries: buildIndex(locale, above, reading) };
  }
  const terms = q.split(/\s+/);
  const hits: { hit: HelpHit; score: number }[] = [];
  for (const e of indexed.entries) {
    let score = 0;
    let ok = true;
    for (const term of terms) {
      const inTitle = fuzzyScore(term, e.title);
      const head = e.heads.find((h) => h.text.toLowerCase().includes(term));
      if (inTitle !== null) score += inTitle + 1_000_000;
      else if (head) score += 500_000;
      else if (e.body.includes(term)) score += 1_000;
      else { ok = false; break; }
    }
    if (!ok) continue;
    const anchorHit = e.heads.find((h) => terms.some((term) => h.text.toLowerCase().includes(term)));
    hits.push({
      score,
      hit: { page: e.page, anchor: anchorHit?.anchor, snippet: anchorHit ? anchorHit.text : e.lede },
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 8).map((h) => h.hit);
}

/** Test seam: a locale change rebuilds lazily, but a table swapped mid-test needs a hard reset. */
export function __resetHelpSearch(): void {
  indexed = null;
}
