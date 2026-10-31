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
import { helpFacts } from './facts';
import { HELP_PAGES, HELP_PAGE_ORDER } from './catalog';
import type { HelpPageId } from './page-schema';
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
const WRITTEN: Reading = { inputMode: 'pc', shape: 'landscape' };

function buildIndex(locale: Locale, reading: Reading): Entry[] {
  const resolveAll = (key: TextKey): string => {
    const read = readingKey(key, reading);
    const own = translateFor(locale, read, helpFacts(locale));
    if (locale === 'en') return own;
    return `${own} ${translateFor('en', read, helpFacts('en'))}`;
  };
  const shown = (key: TextKey): string => translateFor(locale, readingKey(key, reading), helpFacts(locale));
  return HELP_PAGE_ORDER.map((id) => {
    const page = HELP_PAGES[id];
    const heads: Entry['heads'] = [];
    const body: string[] = [resolveAll(page.ledeKey), resolveAll(page.entryKey)];
    for (const s of page.sections) {
      if (s.kind === 'callout') { body.push(resolveAll(s.bodyKey)); continue; }
      // Display text stays in the reader's locale; the search blob carries the English twin too.
      heads.push({ anchor: s.anchor, text: shown(s.titleKey) });
      body.push(resolveAll(s.titleKey));
      if (s.kind === 'prose') for (const k of s.bodyKeys) body.push(resolveAll(k));
      else if (s.kind === 'list') {
        for (const k of s.bodyKeys ?? []) body.push(resolveAll(k));
        for (const item of s.items) body.push(resolveAll(item.key));
      } else if (s.kind === 'steps') {
        for (const k of s.bodyKeys ?? []) body.push(resolveAll(k));
        for (const g of s.groups) for (const k of g.stepKeys) body.push(resolveAll(k));
      } else {
        for (const r of s.rows) body.push(resolveAll(r.doKey));
        for (const k of s.afterKeys ?? []) body.push(resolveAll(k));
      }
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

let indexed: { locale: Locale; reading: string; entries: Entry[] } | null = null;

/** The pages matching `query`, searched as a reader in `reading` sees them. */
export function searchHelp(locale: Locale, query: string, reading: Reading = WRITTEN): HelpHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const read = `${reading.inputMode}/${reading.shape}`;
  if (!indexed || indexed.locale !== locale || indexed.reading !== read) indexed = { locale, reading: read, entries: buildIndex(locale, reading) };
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
