// @vitest-environment jsdom
/** The slider's reading bubble stands on the knob or nowhere; a slider that measures nothing must not park it at the page origin.
 *  A slider filling its row keeps each value at the same share of its track at any length, and reports a value only as it changes. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { I18nProvider } from '../../../../i18n/context';
import { ScaleProvider } from '../../../../ui/design/scale';
import { BrushSizeSlider } from '../../../../ui/shell/bars/BrushSizeSlider';
import { setStoreState } from '../../../_support/store';
import { spec } from '../../../_support/spec';

function Providers({ children }: { children: React.ReactNode }) {
  return <I18nProvider><ScaleProvider value={0.5}>{children}</ScaleProvider></I18nProvider>;
}

beforeEach(() => { setStoreState({ locale: 'en' }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

describe('BarSlider filling its row', () => {
  /** Lays out the slider's own parts at `width` px from x = 10; jsdom has no layout of its own. */
  function layOut(width: number): () => void {
    const native = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (!this.closest('[role=slider]')) return native.call(this);
      return { x: 10, y: 0, left: 10, top: 0, right: 10 + width, bottom: 20, width, height: 20, toJSON: () => ({}) } as DOMRect;
    };
    return () => { HTMLElement.prototype.getBoundingClientRect = native; };
  }

  /** The slider with an owner that takes each value it reports, as the toolbar's store does. */
  function Owned({ reported }: { reported: number[] }) {
    const [value, setValue] = useState(1);
    return <BrushSizeSlider fill value={value} onChange={(v) => { reported.push(v); setValue(v); }} />;
  }

  spec('UI-28', 'a press reads the same value at the same share of the size slider at any length', () => {
    // jsdom has no PointerEvent, and a plain Event carries no `clientX`.
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });
    render(<Providers><Owned reported={[]} /></Providers>);
    const slider = screen.getByRole('slider', { name: 'Brush Size' });
    slider.setPointerCapture = () => {};
    const min = Number(slider.getAttribute('aria-valuemin')), max = Number(slider.getAttribute('aria-valuemax'));
    const read: number[] = [];
    for (const width of [60, 140, 227]) {
      const restore = layOut(width);
      try {
        for (let v = max; v >= min; v--) {
          fireEvent.pointerDown(slider, { clientX: 10 + ((v - min) / (max - min)) * width, pointerId: 1 });
          fireEvent.pointerUp(slider, { pointerId: 1 });
          read.push(Number(slider.getAttribute('aria-valuenow')));
        }
      } finally { restore(); }
    }
    const stops = Array.from({ length: max - min + 1 }, (_, i) => max - i);
    expect(read).toEqual([...stops, ...stops, ...stops]);
  });

  it('reports each stop a drag crosses once, however many moves it takes there', () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });
    const reported: number[] = [];
    render(<Providers><Owned reported={reported} /></Providers>);
    const slider = screen.getByRole('slider', { name: 'Brush Size' });
    slider.setPointerCapture = () => {};
    const min = Number(slider.getAttribute('aria-valuemin')), max = Number(slider.getAttribute('aria-valuemax'));
    const width = 200;
    const restore = layOut(width);
    try {
      fireEvent.pointerDown(slider, { clientX: 10, pointerId: 1, buttons: 1 });
      for (let x = 0; x <= width; x += 2) fireEvent.pointerMove(slider, { clientX: 10 + x, pointerId: 1, buttons: 1 });
      fireEvent.pointerUp(slider, { pointerId: 1 });
    } finally { restore(); }
    expect(reported).toEqual(Array.from({ length: max - min }, (_, i) => min + 1 + i));
  });
});
