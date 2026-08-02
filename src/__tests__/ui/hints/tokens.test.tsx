// The drawn hint tokens. Arrows and mice are asserted as SVG rather than characters: a font
// arrow glyph varies by OS and reads too thin at cap size, so the panel draws them.
// Plain DOM checks (toBe / toBeTruthy) match sibling UI tests; the locale is seeded because
// I18nProvider reads it from the store and the detector would otherwise follow the host.
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { HintTokens } from '../../../ui/hints/tokens';
import type { ResolvedToken } from '../../../ui/hints/catalogue';
import { setStoreState } from '../../_store';

const strip = (tokens: ResolvedToken[]) =>
  render(
    <I18nProvider>
      <HintTokens tokens={tokens} />
    </I18nProvider>,
  );

beforeEach(() => {
  setStoreState({ locale: 'en' });
});

describe('HintTokens', () => {
  it('renders a cap with its label and optional x2 badge', () => {
    strip([{ kind: 'cap', label: 'Ctrl' }, { kind: 'cap', label: 'W', x2: true }]);
    expect(screen.getByText('Ctrl')).toBeTruthy();
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
  });

  // The move token is the letters cap over the arrows cap, whose four arrows are drawn, never
  // font glyphs, and with no separator between the two.
  it('stacks the move keys as one token, letters over four svg arrows', () => {
    const { container } = strip([{ kind: 'pan-stack', letters: 'WASD' }]);
    expect(screen.getByText('WASD')).toBeTruthy();
    expect(container.querySelectorAll('svg').length).toBe(4);
    expect(container.textContent).not.toContain('↑');
    expect(screen.queryByText('or')).toBeNull();
  });

  it('lights the pressed mouse part and draws the mark', () => {
    const { container } = strip([{ kind: 'mouse', button: 'left', mark: 'drag' }]);
    const svg = container.querySelector('svg[data-mouse]')!;
    expect(svg.getAttribute('data-mouse')).toBe('left-drag');
  });

  it('separators speak through i18n', () => {
    strip([{ kind: 'sep', sep: 'or' }, { kind: 'sep', sep: 'plus' }]);
    expect(screen.getByText('or')).toBeTruthy();
    expect(screen.getByText('+')).toBeTruthy();
  });
});
