// @vitest-environment jsdom
// A row that only travels sideways takes a mouse's vertical notches as its own scroll; the hook
// stands aside wherever the native gesture already has an answer.
import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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

describe('useWheelToHorizontal over pointer-transparent space', () => {
  function Scene() {
    const ref = useRef<HTMLDivElement>(null);
    useWheelToHorizontal(ref, { zoom: 1 });
    return <>
      <div data-testid="map" />
      <div data-testid="row" ref={ref} style={{ pointerEvents: 'none' }}><button type="button" style={{ pointerEvents: 'auto' }}>pill</button></div>
      <div data-testid="overlay" />
    </>;
  }

  /** jsdom has no hit testing: the point lies over a gap of the row, above the map, unless an overlay covers it. */
  function mountScene(geom: { scrollWidth: number; clientWidth: number }, covered = false) {
    const { getByTestId } = render(<Scene />);
    const row = getByTestId('row');
    const map = getByTestId('map');
    const overlay = getByTestId('overlay');
    for (const [k, v] of Object.entries({ ...geom, scrollHeight: 40, clientHeight: 40 })) Object.defineProperty(row, k, { value: v, configurable: true });
    let left = 0;
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (v: number) => { left = Math.max(0, Math.min(v, geom.scrollWidth - geom.clientWidth)); },
    });
    const original = document.elementFromPoint;
    document.elementFromPoint = () => (covered ? overlay : row.style.pointerEvents === 'auto' ? row : map);
    onTestFinished(() => { document.elementFromPoint = original; });
    const mapWheel = vi.fn();
    map.addEventListener('wheel', mapWheel);
    return { row, map, mapWheel };
  }

  it('scrolls an overflowing row from a wheel over its gap and keeps the map out of it', () => {
    const { row, map, mapWheel } = mountScene({ scrollWidth: 600, clientWidth: 200 });
    expect(wheel(map, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(50);
    expect(mapWheel).not.toHaveBeenCalled();
    expect(row.style.pointerEvents).toBe('none');
  });

  it('applies a trackpad sideways delta over the gap', () => {
    const { row, map, mapWheel } = mountScene({ scrollWidth: 600, clientWidth: 200 });
    wheel(map, { deltaX: 30, deltaY: 2 });
    expect(row.scrollLeft).toBe(30);
    expect(mapWheel).not.toHaveBeenCalled();
  });

  it('holds the wheel at either stop so it never chains to the map', () => {
    const { row, map, mapWheel } = mountScene({ scrollWidth: 600, clientWidth: 200 });
    expect(wheel(map, { deltaY: -50 })).toBe(true);
    row.scrollLeft = 400;
    expect(wheel(map, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(400);
    expect(mapWheel).not.toHaveBeenCalled();
  });

  it('leaves the map its wheel when the row fits', () => {
    const { row, map, mapWheel } = mountScene({ scrollWidth: 200, clientWidth: 200 });
    expect(wheel(map, { deltaY: 50 })).toBe(false);
    expect(row.scrollLeft).toBe(0);
    expect(mapWheel).toHaveBeenCalledTimes(1);
  });

  it('leaves pinch zoom and a covering surface their wheel', () => {
    const pinch = mountScene({ scrollWidth: 600, clientWidth: 200 });
    expect(wheel(pinch.map, { deltaY: 50, ctrlKey: true })).toBe(false);
    expect(pinch.mapWheel).toHaveBeenCalledTimes(1);
    cleanup();
    const covered = mountScene({ scrollWidth: 600, clientWidth: 200 }, true);
    expect(wheel(covered.map, { deltaY: 50 })).toBe(false);
    expect(covered.row.scrollLeft).toBe(0);
    expect(covered.mapWheel).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the row unmounts', () => {
    const { map, mapWheel } = mountScene({ scrollWidth: 600, clientWidth: 200 });
    cleanup();
    document.body.appendChild(map);
    wheel(map, { deltaY: 50 });
    expect(mapWheel).toHaveBeenCalledTimes(1);
    map.remove();
  });
});
