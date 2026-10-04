// A row that only travels sideways takes a mouse's vertical notches as its own scroll; the hook
// stands aside wherever the native gesture already has an answer.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useWheelToHorizontal } from '../../../ui/primitives/wheel-horizontal';

function Row({ zoom }: { zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useWheelToHorizontal(ref, { zoom });
  return <div data-testid="row" ref={ref} />;
}

/** jsdom has no layout, so the scroll geometry is declared per case. */
function mountRow(geom: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }, zoom = 1) {
  const { getByTestId } = render(<Row zoom={zoom} />);
  const el = getByTestId('row');
  for (const [k, v] of Object.entries(geom)) Object.defineProperty(el, k, { value: v, configurable: true });
  let left = 0;
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (v: number) => { left = Math.max(0, Math.min(v, geom.scrollWidth - geom.clientWidth)); },
  });
  return el;
}

function wheel(el: HTMLElement, init: WheelEventInit): boolean {
  const e = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  el.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('useWheelToHorizontal', () => {
  it('turns vertical notches into sideways travel on a row with only sideways room', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 });
    const prevented = wheel(el, { deltaY: 50 });
    expect(el.scrollLeft).toBe(50);
    expect(prevented).toBe(true);
  });

  it.each([0.5, 1, 2])('keeps pixel and page gestures in their own coordinate spaces at zoom %s', (zoom) => {
    const el = mountRow({ scrollWidth: 1600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 }, zoom);
    wheel(el, { deltaY: 60 });
    expect(el.scrollLeft * zoom).toBe(60);
    el.scrollLeft = 0;
    wheel(el, { deltaY: 1, deltaMode: 2 });
    expect(el.scrollLeft).toBe(200);
  });

  it('scales line-mode deltas into pixels', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 });
    wheel(el, { deltaY: 3, deltaMode: 1 });
    expect(el.scrollLeft).toBe(120);
  });

  it('stands aside when the element has vertical room of its own', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 400, clientHeight: 100 });
    const prevented = wheel(el, { deltaY: 50 });
    expect(el.scrollLeft).toBe(0);
    expect(prevented).toBe(false);
  });

  it('yields to a sideways-dominant gesture and to pinch', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 });
    expect(wheel(el, { deltaY: 10, deltaX: 30 })).toBe(false);
    expect(wheel(el, { deltaY: 50, ctrlKey: true })).toBe(false);
    expect(el.scrollLeft).toBe(0);
  });

  it('hands off at a fractional browser scroll limit', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 });
    el.scrollLeft = 398;
    expect(wheel(el, { deltaY: 50 })).toBe(false);
  });

  it('lets the event bubble at the stop so an outer scroller can take it', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 });
    el.scrollLeft = 400; // the far stop
    const prevented = wheel(el, { deltaY: 50 });
    expect(el.scrollLeft).toBe(400);
    expect(prevented).toBe(false);
  });
});
