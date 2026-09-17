/** The slider's reading bubble stands on the knob or nowhere; a slider that measures nothing must not park it at the page origin. */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { ScaleProvider } from '../../../../ui/design/scale';
import { BrushSizeSlider } from '../../../../ui/shell/bars/BrushSizeSlider';
import { setStoreState } from '../../../_store';

function Providers({ children }: { children: React.ReactNode }) {
  return <I18nProvider><ScaleProvider value={0.5}>{children}</ScaleProvider></I18nProvider>;
}

beforeEach(() => { setStoreState({ locale: 'en' }); });
afterEach(cleanup);

describe('BarSlider reading', () => {
  it('keeps the reading layer hidden while the slider has no measured width', () => {
    render(<Providers><BrushSizeSlider value={3} onChange={() => {}} /></Providers>);
    fireEvent.pointerEnter(screen.getByRole('slider', { name: 'Brush Size' }));
    const bubble = screen.getByTestId('shell-slider-reading');
    const layer = bubble.parentElement as HTMLElement;
    expect(layer.style.position).toBe('fixed');
    expect(layer.style.visibility).toBe('hidden');
  });
});
