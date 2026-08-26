/**
 * Scaled text must not sit on a line box it shares with an unscaled strut.
 *
 * A label positioned at its design coordinate takes a font-size derived from the
 * scale, while the box around it inherits the host's plain UA font. If the label is
 * INLINE-level inside that box, it is baseline-aligned to the box's strut, which is
 * sized by the unscaled inherited font. The two only agree at one scale, so the
 * label slides away from its anchor as the scale changes: measured in a browser on
 * the deleted menu tiles this rule came from, the gap under a tile grew from 7.3 to 16.3
 * design px between 100% and 150% page zoom, dropping the label by the whole
 * designed gap. Blockifying the text (block, or a flex item) removes the line box,
 * so the label's top is its own box top at every scale.
 *
 * jsdom does no layout, so this pins the CSS contract that prevents it rather than
 * the geometry; the geometry was verified in a real browser across zoom levels.
 */
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { ScaleProvider } from '../../../ui/design/scale';
import { FitText } from '../../../ui/primitives/FitText';

function markup(node: React.ReactNode): string {
  const { container } = render(
    <I18nProvider><ScaleProvider value={0.5631}>{node}</ScaleProvider></I18nProvider>,
  );
  const html = container.innerHTML;
  cleanup();
  return html;
}

describe('scaled labels are blockified', () => {
  it('FitText wraps its label in a flex box, which blockifies it whatever its own display says', () => {
    const html = markup(<FitText cx={10} cy={10} maxW={100} size={30}>label</FitText>);
    // A flex item is blockified by its container whatever the inner span's own display says, so what
    // the markup has to show is that the parent IS flex.
    expect(html).toMatch(/<span style="[^"]*display:\s*flex[^"]*"><span[^>]*font-size/);
  });
});
