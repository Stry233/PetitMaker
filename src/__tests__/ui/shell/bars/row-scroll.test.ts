// @vitest-environment jsdom
/** `reveal` brings a tab into its own row's view without scrolling any ancestor. */
import { describe, it, expect, vi } from 'vitest';
import { reveal } from '../../../../ui/shell/bars/row-scroll';

describe('reveal', () => {
  it('moves only the tab\'s own row, never an ancestor, and ignores an absent target', () => {
    const article = document.createElement('div');
    const row = document.createElement('div');
    const tab = document.createElement('button');
    article.append(row);
    row.append(tab);
    article.scrollTop = 650;
    row.scrollTop = 7;
    // Metrics that put the tab past the row's right edge, so `reveal` has to act.
    Object.defineProperty(row, 'clientWidth', { value: 100 });
    Object.defineProperties(tab, { offsetLeft: { value: 200 }, offsetWidth: { value: 50 } });
    tab.scrollIntoView = vi.fn(() => { article.scrollTop = 0; });
    reveal(tab);
    reveal(null);
    expect(row.scrollTop).toBe(7);
    expect(article.scrollTop).toBe(650);
    expect(tab.scrollIntoView).not.toHaveBeenCalled();
  });
});
