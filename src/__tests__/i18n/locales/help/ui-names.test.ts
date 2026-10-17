/*
 * Copy names a control by its key: `{ui:key}` shows the control's current label, so a renamed button
 * renames itself in every Help page and every interface string that mentions it. Quoted interface
 * names (corner brackets in zh and ja, guillemets in ru), in Help and in the interface tables alike,
 * are tokens or match a live interface string; a bold label in Help's other locales, or a quoted one
 * in en, that equals an interface string is a token too. A label that a control wears with a closing
 * ellipsis counts with the ellipsis left out, as a token renders it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../platform/build/build-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../platform/build/build-info')>();
  return { ...actual, IS_DEV_BUILD: true };
});
import { HELP_TABLES, installHelpTables, translations } from '../../../_support/locale-tables';
import { translateFor } from '../../../../i18n/context';
import { helpFacts } from '../../../../ui/help/facts';
import { LOCALES, type Locale } from '../../../../core/model/locale';
import type { TextKey } from '../../../../i18n/keys';

installHelpTables();

const UI_TOKEN = /\{ui:([a-z0-9_.]+)\}/g;
const PLURAL = /_(zero|one|two|few|many)$/;

/** Keys and marks the interface prints the same way in every locale. */
const AS_PRINTED = new Set(['Shift', 'Ctrl', 'Alt', 'Delete', 'Esc', 'Enter', 'Tab', 'Space', '#', '?']);

/** Quotes that mark an interface name, per locale; the others mark labels in bold. */
const QUOTES: Partial<Record<Locale, RegExp>> = { zh: /「([^」]+)」/g, ja: /「([^」]+)」/g, ru: /«([^»]+)»/g };
const BOLD = /\*\*([^*]+)\*\*/g;
/** English quotes typed text, straight or curly; a quoted span equal to an interface string is a label. */
const EN_QUOTE = /"([^"]+)"|“([^”]+)”/g;
/** Search words are typed text, never labels, even where a word equals one. */
const SEARCH_WORDS = /^catalog\.terms_/;
/** Another product's own labels, which Help writes as printed there. */
const FOREIGN_LABELS: Readonly<Record<string, readonly string[]>> = { 'help.agentsetup.keys_claude_2': ['Settings'] };
/** The game's own screens, which the planet scan's steps name as the game prints them. */
const GAME_LABELS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [
    'planet.video_step_region', 'planet.video_step_zoom', 'planet.video_step_clear', 'planet.video_step_rows', 'planet.video_fix_zoom', 'planet.video_fix_fast',
    'planet.scan_failed_not_map_view', 'planet.scan_failed_zoom', 'planet.scan_failed_zoom_changed',
  ].map((key) => [key, ['地图', 'マップ']]),
);

/** Text as a reader compares it: typographic apostrophes and spaces fold together. */
const fold = (text: string) => text.replace(/[’‘]/g, "'").replace(/[  ]/g, ' ').trim();
/** A label quoted in prose may leave out the ellipsis that marks a control opening a further step. */
const bare = (text: string) => fold(text).replace(/(…|\.\.\.)$/, '');

/** Help page and section titles count as interface strings: Help refers to them by name. */
const isTitle = (key: string) => /\.(title|nav)$|_t$/.test(key);

interface InterfaceStrings {
  /** Folded label text to the first key that shows it. */
  readonly plain: Map<string, string>;
  /** Labels with the ellipsis left out, to their key. */
  readonly elided: Map<string, string>;
  /** Strings with params, each param matching any text. */
  readonly patterns: RegExp[];
}

function interfaceStrings(locale: Locale): InterfaceStrings {
  const plain = new Map<string, string>();
  const elided = new Map<string, string>();
  const patterns: RegExp[] = [];
  const keys = [
    ...Object.keys(translations[locale]),
    ...Object.keys(HELP_TABLES[locale]).filter(isTitle),
  ] as TextKey[];
  for (const key of keys) {
    if (key === 'app.name') continue;
    const value = fold(translateFor(locale, key));
    if (/\{[a-zA-Z]+\}/.test(value)) {
      const body = value.split(/\{[a-zA-Z]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+');
      patterns.push(new RegExp(`^${body}$`));
    } else if (!PLURAL.test(key)) {
      if (!plain.has(value)) plain.set(value, key);
      if (!elided.has(bare(value))) elided.set(bare(value), key);
    }
  }
  return { plain, elided, patterns };
}

/** The key of the label `shown` matches, whole or with its ellipsis left out. */
const labelOf = ({ plain, elided }: InterfaceStrings, shown: string): string | undefined => plain.get(shown) ?? elided.get(shown);

/** A span of Help source with its tokens and facts filled in. */
function render(locale: Locale, span: string): string {
  const facts = helpFacts(locale);
  return span
    .replace(UI_TOKEN, (_, key: string) => translateFor(locale, key as TextKey))
    .replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => (name in facts ? String(facts[name]) : whole));
}

describe('Help names controls by key', () => {
  it('shows the label the control wears in the same locale', () => {
    for (const locale of LOCALES) {
      const text = translateFor(locale, 'help.agenttrouble.banners_b1');
      expect(text).toContain(translateFor(locale, 'agent.banner_action_edit_endpoint'));
      expect(text).not.toContain('{ui:');
    }
  });

  it('names only keys that exist', () => {
    const known = new Set([...Object.keys(translations.en), ...Object.keys(HELP_TABLES.en)]);
    for (const locale of LOCALES) {
      for (const table of [translations[locale], HELP_TABLES[locale]]) {
        for (const [key, value] of Object.entries(table)) {
          for (const [, ref] of value.matchAll(UI_TOKEN)) expect(known.has(ref!), `${locale} ${key} names {ui:${ref}}`).toBe(true);
        }
      }
    }
  });

  it.each(Object.keys(QUOTES) as Locale[])('quotes only interface names in %s Help, as tokens', (locale) => {
    const strings = interfaceStrings(locale);
    const problems: string[] = [];
    for (const [key, value] of Object.entries(HELP_TABLES[locale])) {
      for (const [, span] of value.matchAll(QUOTES[locale]!)) {
        const inner = span!.replace(/^\*\*|\*\*$/g, '');
        if (/^\{ui:[a-z0-9_.]+\}$/.test(inner)) continue;
        const shown = fold(render(locale, inner));
        if (AS_PRINTED.has(shown)) continue;
        const label = labelOf(strings, shown);
        if (label && !inner.includes('{')) problems.push(`${key}: write {ui:${label}} for "${inner}"`);
        else if (!label && !strings.patterns.some((re) => re.test(shown))) problems.push(`${key}: "${shown}" is no interface string`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(Object.keys(QUOTES) as Locale[])('quotes interface labels as tokens in the %s interface table', (locale) => {
    const strings = interfaceStrings(locale);
    const problems: string[] = [];
    for (const [key, value] of Object.entries(translations[locale])) {
      if (SEARCH_WORDS.test(key)) continue;
      for (const [, inner] of value.matchAll(QUOTES[locale]!)) {
        if (inner!.includes('{') || GAME_LABELS[key]?.includes(inner!)) continue;
        const label = labelOf(strings, fold(inner!));
        if (label && label !== key && !AS_PRINTED.has(fold(inner!))) problems.push(`${key}: write {ui:${label}} for "${inner}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(LOCALES.filter((locale) => !QUOTES[locale]))('writes bold labels as tokens in %s', (locale) => {
    const strings = interfaceStrings(locale);
    const problems: string[] = [];
    for (const [key, value] of Object.entries(HELP_TABLES[locale])) {
      for (const [, span] of value.matchAll(BOLD)) {
        if (FOREIGN_LABELS[key]?.includes(span!)) continue;
        const label = labelOf(strings, fold(span!));
        if (label && !span!.includes('{') && !AS_PRINTED.has(fold(span!))) problems.push(`${key}: write {ui:${label}} for "${span}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('writes quoted labels as tokens in en', () => {
    const strings = interfaceStrings('en');
    const problems: string[] = [];
    for (const [key, value] of Object.entries(HELP_TABLES.en)) {
      for (const match of value.matchAll(EN_QUOTE)) {
        const span = match[1] ?? match[2];
        const label = labelOf(strings, fold(span!));
        if (label && !SEARCH_WORDS.test(label) && !span!.includes('{') && !AS_PRINTED.has(fold(span!))) problems.push(`${key}: write {ui:${label}} for "${span}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});
