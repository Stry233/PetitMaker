/*
 * Help as text: a page reads as its opening, its sections and its questions in the reader's
 * language, a key table names the keys the live keymap binds, and a search answers with the
 * passages that hold the words.
 */
import { describe, expect, it } from 'vitest';
import { HELP_PAGES } from '../../../editor/help/catalog';
import { SEARCH_PASSAGE_CAP, pagePassages, searchPassages, sectionAnchorOf, type HelpReader } from '../../../editor/help/passages';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { prettyCombo } from '../../../platform/input/combo';
import { helpFacts } from '../../../editor/help/facts';
import { translateFor } from '../../../i18n/context';
import { STAND_IN_FACTS_ABOVE } from '../../_support/help-facts';
import { HELP_TABLES, installHelpTables } from '../../_support/locale-tables';

installHelpTables();

const reader = (over: Partial<HelpReader> = {}): HelpReader => ({ locale: 'en', factsAbove: STAND_IN_FACTS_ABOVE, overrides: {}, ...over });

describe('a Help page as passages', () => {
  it('opens with the page, then gives each headed section under its anchor and each question', () => {
    const page = HELP_PAGES.camera;
    const passages = pagePassages(page, reader({ locale: 'zh' }));
    expect(passages[0]).toMatchObject({ page: 'camera', heading: HELP_TABLES.zh['help.camera.title'] });
    expect(passages[0]!.anchor).toBeUndefined();
    const anchors = page.sections.flatMap((section) => (section.kind === 'callout' ? [] : [section.anchor]));
    expect(passages.flatMap((passage) => (passage.anchor ? [passage.anchor] : []))).toEqual(anchors);
    expect(passages.filter((passage) => passage.anchor === undefined)).toHaveLength(1 + page.qa.length);
  });

  it('fills the facts the copy quotes and leaves no mark of the page behind', () => {
    for (const locale of ['en', 'zh'] as const) {
      for (const page of Object.values(HELP_PAGES)) {
        for (const passage of pagePassages(page, reader({ locale }))) {
          expect(`${passage.heading}\n${passage.text}`, `${locale} ${page.id} ${passage.anchor ?? ''}`).not.toMatch(/\{[A-Za-z0-9_:.]+\}|\[\[|\*\*/);
        }
      }
    }
  });

  it('names the key the user moved a command to in the key table', () => {
    const keys = (overrides: HelpReader['overrides']): string => pagePassages(HELP_PAGES.notes, reader({ overrides })).find((passage) => passage.anchor === 'notes-tools')!.text;
    const doText = translateFor('en', 'annot.measure');
    expect(keys({})).toContain(`${doText}: ${prettyCombo(effectiveCombo({}, 'tool.measure'))}`);
    expect(keys({ 'tool.measure': 'f9' })).toContain(`${doText}: F9`);
  });

  it('shows a touch reader no key table, as the page does', () => {
    const anchors = pagePassages(HELP_PAGES.notes, reader({ reading: { inputMode: 'touch', shape: 'portrait' } })).map((passage) => passage.anchor);
    expect(anchors).not.toContain('notes-tools');
    expect(anchors).toContain('notes-zone');
  });

  it('finds the section a list item stands in', () => {
    const list = HELP_PAGES.planet.sections.find((section) => section.kind === 'list' && section.items.some((item) => item.anchor))!;
    const item = list.kind === 'list' ? list.items.find((entry) => entry.anchor)! : undefined;
    expect(sectionAnchorOf(HELP_PAGES.planet, item!.anchor!)).toBe(list.kind === 'list' ? list.anchor : '');
    expect(sectionAnchorOf(HELP_PAGES.planet, 'no-such-anchor')).toBeUndefined();
  });
});

describe('a search over passages', () => {
  it('answers in the reader\'s language with the section whose heading matched first', () => {
    const [first] = searchPassages(HELP_TABLES.zh['help.camera.keys_t']!, reader({ locale: 'zh' }));
    expect(first).toMatchObject({ page: 'camera', anchor: 'camera-keys', heading: HELP_TABLES.zh['help.camera.keys_t'] });
  });

  it('puts the passage holding every word ahead of one holding some', () => {
    const rotate = HELP_PAGES.objects.sections.find((section) => section.kind !== 'callout' && section.anchor === 'objects-rotate')!;
    const words = rotate.kind === 'prose' ? translateFor('en', rotate.bodyKeys[0]!, helpFacts('en')).replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((word) => word.length > 5).slice(0, 3) : [];
    expect(words.length).toBe(3);
    const [first] = searchPassages(words.join(' '), reader());
    expect(first).toMatchObject({ page: 'objects', anchor: 'objects-rotate' });
  });

  it('finds a passage from English words while the language is another', () => {
    const passages = searchPassages('camera', reader({ locale: 'zh' }));
    expect(passages.some((passage) => passage.page === 'camera')).toBe(true);
    expect(passages[0]!.heading).not.toMatch(/camera/i);
  });

  it('keeps to its cap and answers nonsense with nothing', () => {
    expect(searchPassages('map', reader()).length).toBeLessThanOrEqual(SEARCH_PASSAGE_CAP);
    expect(searchPassages('map', reader(), 2)).toHaveLength(2);
    expect(searchPassages('zzqqxxyy', reader())).toEqual([]);
  });
});
