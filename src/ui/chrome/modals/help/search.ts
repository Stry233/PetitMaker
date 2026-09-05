/*
 * search.ts — the Help Center's index, built from the descriptors' RESOLVED strings.
 *
 * Indexing the same keys the pages render (title, headings, bodies, Q&A) in the active locale AND
 * English is what makes the search a view of the docs rather than a second copy of them, and it is
 * the catalog search's own bilingual habit. Ranking reuses `core/model/fuzzy` so a typo tolerated
 * by the item search is tolerated here too.
 */
import { fuzzyScore } from '../../../../core/model/fuzzy';
import { translateFor } from '../../../../i18n/context';
import type { Locale } from '../../../../core/model/types';
import { helpFacts } from './facts';
import { HELP_PAGES, HELP_PAGE_ORDER } from './catalog';
import type { HelpPageId } from './page-schema';

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

function resolveAll(locale: Locale, key: string): string {
  const facts = helpFacts(locale);
  const own = translateFor(locale, key, facts);
  if (locale === 'en') return own;
  return `${own} ${translateFor('en', key, helpFacts('en'))}`;
}

function buildIndex(locale: Locale): Entry[] {
  return HELP_PAGE_ORDER.map((id) => {
    const page = HELP_PAGES[id];
    const heads: Entry['heads'] = [];
    const body: string[] = [resolveAll(locale, page.ledeKey)];
    for (const s of page.sections) {
      if (s.kind === 'callout') { body.push(resolveAll(locale, s.bodyKey)); continue; }
      // Display text stays in the reader's locale; the search blob carries the English twin too.
      heads.push({ anchor: s.anchor, text: translateFor(locale, s.titleKey, helpFacts(locale)) });
      body.push(resolveAll(locale, s.titleKey));
      if (s.kind === 'prose') for (const k of s.bodyKeys) body.push(resolveAll(locale, k));
      else {
        for (const r of s.rows) body.push(resolveAll(locale, r.doKey));
        for (const k of s.afterKeys ?? []) body.push(resolveAll(locale, k));
      }
    }
    for (const qa of page.qa) { body.push(resolveAll(locale, qa.qKey)); body.push(resolveAll(locale, qa.aKey)); }
    return {
      page: id,
      title: resolveAll(locale, page.titleKey),
      lede: translateFor(locale, page.ledeKey, helpFacts(locale)),
      heads,
      body: body.join(' ').toLowerCase(),
    };
  });
}

let indexed: { locale: Locale; entries: Entry[] } | null = null;

export function searchHelp(locale: Locale, query: string): HelpHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (!indexed || indexed.locale !== locale) indexed = { locale, entries: buildIndex(locale) };
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
