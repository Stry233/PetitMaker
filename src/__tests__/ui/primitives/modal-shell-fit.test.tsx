import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { ModalShell } from '../../../ui/primitives/ModalShell';
import { fittedUiScale } from '../../../ui/design/scale';

/** jsdom folds `min(620px, 1322px)` to `calc(620px)`, so lengths are compared as numbers. */
const px = (css: string): number => parseFloat(css.replace(/[^0-9.]/g, ''));

const size = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
};

function renderShell(props: Partial<Parameters<typeof ModalShell>[0]>) {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <ModalShell open onClose={() => {}} ariaLabel="Sized" {...props}><div>content</div></ModalShell>
      </I18nProvider>
    </MotionConfig>,
  );
}

afterEach(() => { cleanup(); size(1024, 768); });

describe('ModalShell sizes from the visible viewport', () => {
  it('caps height and width in pixels of the measured window, not in viewport units', () => {
    size(844, 390);
    renderShell({ width: 620, maxVwPct: 94, maxVh: 92, maxVw: 94, cardStyle: { padding: 0, border: 'none' } });
    const card = screen.getByRole('dialog');
    const chrome = fittedUiScale(844, 390, 1);
    expect(px(card.style.maxHeight)).toBeCloseTo((0.92 * 390) / chrome, 6);
    expect(px(card.style.maxWidth)).toBeCloseTo((0.94 * 844) / chrome, 6);
    expect(px(card.style.width)).toBeCloseTo(Math.min(620, (0.94 * 844) / chrome), 6);
  });

  it('takes a content-box card\'s padding and border off the caps, so the whole card fits', () => {
    size(844, 390);
    renderShell({ width: 620, maxVwPct: 94, maxVh: 92, cardStyle: { padding: '26px 26px 24px', border: 'none' } });
    const card = screen.getByRole('dialog');
    const chrome = fittedUiScale(844, 390, 1);
    expect(px(card.style.maxHeight)).toBeCloseTo((0.92 * 390) / chrome - 50, 6);
    expect(px(card.style.width)).toBeCloseTo(Math.min(620, (0.94 * 844) / chrome - 52), 6);
  });

  it('follows the window as browser bars hide and show', () => {
    size(844, 300);
    renderShell({ maxVh: 92, cardStyle: { padding: 0, border: 'none' } });
    const chromeShort = fittedUiScale(844, 300, 1);
    expect(px(screen.getByRole('dialog').style.maxHeight)).toBeCloseTo((0.92 * 300) / chromeShort, 6);
    act(() => { size(844, 390); window.dispatchEvent(new Event('resize')); });
    const chromeTall = fittedUiScale(844, 390, 1);
    expect(px(screen.getByRole('dialog').style.maxHeight)).toBeCloseTo((0.92 * 390) / chromeTall, 6);
  });
});
