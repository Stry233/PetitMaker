/**
 * Scaled text must not sit on a line box it shares with an unscaled strut.
 *
 * A tile label (and any label like it) is positioned at its design coordinate and
 * given a font-size derived from the menu scale, while the box around it inherits
 * the host's plain UA font. If the label is INLINE-level inside that box, it is
 * baseline-aligned to the box's strut, which is sized by the unscaled inherited
 * font. The two only agree at one scale, so the label slides away from its tile as
 * the scale changes: measured on the real hub, the gap under a tile grew from 7.3
 * to 16.3 design px between 100% and 150% page zoom, dropping the label by the
 * whole designed gap. Blockifying the text (block, or a flex item) removes the
 * line box, so the label's top is its own box top at every scale.
 *
 * jsdom does no layout, so this pins the CSS contract that prevents it rather than
 * the geometry; the geometry was verified in a real browser across zoom levels.
 */
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../i18n/context';
import { ScaleProvider } from '../../ui/menu/scale';
import { MenuTile } from '../../ui/menu/MenuTile';
import { FitText } from '../../ui/menu/FitText';
import { GRID_TILES } from '../../ui/menu/metrics';

function markup(node: React.ReactNode): string {
  const { container } = render(
    <I18nProvider><ScaleProvider value={0.5631}>{node}</ScaleProvider></I18nProvider>,
  );
  const html = container.innerHTML;
  cleanup();
  return html;
}

/** Every element that sets its own font-size, with the display it renders at. */
function scaledTextDisplays(html: string): string[] {
  return [...html.matchAll(/style="([^"]*font-size[^"]*)"/g)].map(([, style]) => {
    const display = /display:\s*([a-z-]+)/.exec(style ?? '');
    return display ? display[1]! : 'inline'; // no display set = inline, the bug
  });
}

const INLINE_LEVEL = ['inline', 'inline-block', 'inline-flex'];

describe('scaled labels are blockified', () => {
  it('a tile label renders its text as a block, not an inline-level box', () => {
    const html = markup(<MenuTile spec={GRID_TILES[0]!} onSelect={() => {}} />);
    const displays = scaledTextDisplays(html);
    expect(displays.length).toBeGreaterThan(0);
    for (const d of displays) expect(INLINE_LEVEL).not.toContain(d);
  });

  it('FitText wraps its label in a flex box, which blockifies it whatever its own display says', () => {
    const html = markup(<FitText cx={10} cy={10} maxW={100} size={30}>label</FitText>);
    // A flex item is blockified by its container, so the inner span's own
    // inline-flex is harmless — what matters is that the parent IS flex.
    expect(html).toMatch(/<span style="[^"]*display:\s*flex[^"]*"><span[^>]*font-size/);
  });
});
