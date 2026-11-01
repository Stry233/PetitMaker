// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { ModalShell } from '../../../ui/primitives/ModalShell';

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

describe('ModalShell caps', () => {
  it('follows the window as browser bars hide and show', () => {
    size(844, 300);
    renderShell({ cap: { h: 92 }, cardStyle: { padding: 0, border: 'none' } });
    const short = screen.getByRole('dialog').style.maxHeight;
    act(() => { size(844, 390); window.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('dialog').style.maxHeight).not.toBe(short);
  });
});
