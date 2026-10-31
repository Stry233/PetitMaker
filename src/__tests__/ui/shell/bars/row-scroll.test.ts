// @vitest-environment jsdom
/** `reveal` brings a tab into its own row's view without scrolling any ancestor. */
import { describe, it, expect, vi } from 'vitest';
import { reveal } from '../../../../ui/shell/bars/row-scroll';

describe('reveal', () => {
  it.each([
    [50, 20, 100, 50],
    [120, 50, 100, 100],
    [200, 50, 100, 150],
    [50, 200, 100, 100],
    [220, 200, 100, 220],
  ])('reveals a tab at %i with width %i inside its row only', (left, width, initial, expected) => {
    const article = document.createElement('div');
    const row = document.createElement('div');
    const tab = document.createElement('button');
    article.append(row);
    row.append(tab);
    article.scrollTop = 650;
    row.scrollTop = 7;
    row.scrollLeft = initial;
    Object.defineProperty(row, 'clientWidth', { value: 100 });
    Object.defineProperties(tab, { offsetLeft: { value: left }, offsetWidth: { value: width } });
    tab.scrollIntoView = vi.fn(() => { article.scrollTop = 0; });
    reveal(tab);
    expect(row.scrollLeft).toBe(expected);
    expect(row.scrollTop).toBe(7);
    expect(article.scrollTop).toBe(650);
    expect(tab.scrollIntoView).not.toHaveBeenCalled();
  });

  it('leaves a visible tab and absent targets alone', () => {
    const row = document.createElement('div');
    const tab = document.createElement('button');
    row.append(tab);
    row.scrollLeft = 100;
    Object.defineProperty(row, 'clientWidth', { value: 100 });
    Object.defineProperties(tab, { offsetLeft: { value: 120 }, offsetWidth: { value: 30 } });
    reveal(tab);
    reveal(null);
    expect(row.scrollLeft).toBe(100);
  });
});
