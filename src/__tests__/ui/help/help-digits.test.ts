/**
 * Help quotes a number the code owns through a `{fact}` token, never as typed digits, so a changed
 * constant changes the copy. The English table may carry a literal number only where this file names
 * it: an angle, an illustrative example, a figure's own setting or a unit. The list only shrinks.
 */
import { describe, expect, it } from 'vitest';
import { HELP_TABLES } from '../../_support/locale-tables';
import { helpFacts } from '../../../ui/help/facts';
import { LOCALES } from '../../../core/model/locale';

const LITERAL_DIGITS: Readonly<Record<string, readonly string[]>> = {
  'help.fig.terrain_2': ['45'],
  'help.terrain.line_b1': ['45'],
  'help.fig.rotate_2': ['90'],
  'help.objects.rotate_b1': ['90'],
  'help.select.rotate_b1': ['90'],
  'help.select.menu_b1': ['0', '90', '180', '270'],
  'help.frame.rail_b1': ['0'],
  'help.frame.a3': ['1'],
  'help.faq.mountain_b1': ['1'],
  'help.notes.measure_b1': ['1', '84'],
  'help.layers.list_b1': ['1', '2', '3'],
  'help.layers.a2': ['1', '2', '3'],
  'help.sharelook.layers_b1': ['3'],
  'help.load.a3': ['100'],
  'help.fig.brushwidth_2': ['3'],
  'help.maze.fig1': ['1'],
  'help.maze.fig2': ['2'],
};

/** A number standing on its own: not part of a word (2D), a target (`[[...]]`) or a token. */
const NUMBER = /(?<![\w.,#[-])\d+(?:[.,]\d+)?(?![\w\]])/g;
const prose = (text: string) => text.replace(/\{\w+\}/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ');
const numbersIn = (text: string): string[] => prose(text).match(NUMBER) ?? [];

describe('help numbers come from facts', () => {
  it('types no number in English beyond the named literals', () => {
    const stray = Object.entries(HELP_TABLES.en).flatMap(([key, text]) =>
      numbersIn(text).filter((n) => !(LITERAL_DIGITS[key] ?? []).includes(n)).map((n) => `${key}: ${n}`));
    expect(stray).toEqual([]);
  });

  it('keeps every literal the list names in use', () => {
    const unused = Object.entries(LITERAL_DIGITS).flatMap(([key, digits]) =>
      digits.filter((d) => !numbersIn(HELP_TABLES.en[key] ?? '').includes(d)).map((d) => `${key}: ${d}`));
    expect(unused).toEqual([]);
  });

  it('never types in a translation the value of a fact its English quotes through a token', () => {
    const typed: string[] = [];
    for (const locale of LOCALES) {
      const facts = helpFacts(locale);
      for (const [key, en] of Object.entries(HELP_TABLES.en)) {
        const text = HELP_TABLES[locale][key] ?? '';
        const numbers = numbersIn(text);
        for (const [, token] of en.matchAll(/\{(\w+)\}/g)) {
          const value = facts[token!];
          if (value === undefined || text.includes(`{${token}}`)) continue;
          if (numbers.includes(String(value))) typed.push(`${locale} ${key}: {${token}}`);
        }
      }
    }
    expect(typed).toEqual([]);
  });
});
