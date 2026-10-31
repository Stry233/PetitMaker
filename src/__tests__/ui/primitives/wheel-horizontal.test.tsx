// @vitest-environment jsdom
// A row that only travels sideways takes a mouse's vertical notches as its own scroll; the hook
// stands aside wherever the native gesture already has an answer.
import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useWheelToHorizontal } from '../../../ui/primitives/wheel-horizontal';
import { rowWheel } from '../../../ui/primitives/scroll-input';

function Row({ zoom, clipsDown = false }: { zoom: number; clipsDown?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useWheelToHorizontal(ref, { zoom });
  // Both axes as a browser computes them: `visible` beside `auto` computes to `auto`.
  return <div data-testid="row" ref={ref} style={{ overflowX: 'auto', overflowY: clipsDown ? 'hidden' : 'auto' }} />;
}

/** jsdom has no layout, so the scroll geometry is declared per case. */
function mountRow(geom: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }, zoom = 1, clipsDown = false) {
  const { getByTestId } = render(<Row zoom={zoom} clipsDown={clipsDown} />);
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

  it('[UI-14] takes a vertical wheel on a row whose vertical overflow is clipped rather than scrolled', () => {
    const el = mountRow({ scrollWidth: 600, clientWidth: 200, scrollHeight: 400, clientHeight: 100 }, 1, true);
    expect(wheel(el, { deltaY: 50 })).toBe(true);
    expect(el.scrollLeft).toBeGreaterThan(0);
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
      <div data-testid="row" ref={ref} style={{ pointerEvents: 'none', overflowX: 'auto' }}><button type="button" style={{ pointerEvents: 'auto' }}>pill</button></div>
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

  it('[UI-14] scrolls an overflowing row from a wheel over its gap and keeps the map out of it', () => {
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

  it('[UI-14] holds the wheel at either stop so it never chains to the map', () => {
    const { row, map, mapWheel } = mountScene({ scrollWidth: 600, clientWidth: 200 });
    expect(wheel(map, { deltaY: -50 })).toBe(true);
    row.scrollLeft = 400;
    expect(wheel(map, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(400);
    expect(mapWheel).not.toHaveBeenCalled();
  });

  it('[UI-14] leaves the map its wheel when the row fits', () => {
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

describe('rowWheel', () => {
  const deltas = [-120, -40, -3, 0, 3, 40, 120];
  const modes = [0, 1, 2];

  it('travels a sideways-dominant gesture whatever scrolls vertically, and a vertical-dominant one only when nothing does', () => {
    for (const deltaX of deltas) for (const deltaY of deltas) for (const deltaMode of modes) for (const taken of [false, true]) {
      const travel = rowWheel({ deltaX, deltaY, deltaMode }, 200, 1.5, () => taken);
      const sideways = Math.abs(deltaX) >= Math.abs(deltaY);
      const along = sideways ? deltaX : deltaY;
      if (along === 0 || (!sideways && taken)) { expect(travel).toBeNull(); continue; }
      expect(travel!.redirected).toBe(!sideways);
      expect(Math.sign(travel!.by)).toBe(Math.sign(along));
    }
  });

  it('never travels on pinch', () => {
    for (const deltaX of deltas) for (const deltaY of deltas) {
      expect(rowWheel({ deltaX, deltaY, deltaMode: 0, ctrlKey: true }, 200, 1, () => false)).toBeNull();
    }
  });
});

describe('useWheelToHorizontal and the scrollers around a row', () => {
  function Page({ pointerEvents }: { pointerEvents: 'auto' | 'none' }) {
    const ref = useRef<HTMLDivElement>(null);
    useWheelToHorizontal(ref, { zoom: 1 });
    return (
      <div data-testid="page" style={{ overflowY: 'auto' }}>
        <div data-testid="row" ref={ref} style={{ overflowX: 'auto', pointerEvents }}>
          <span data-testid="cell" style={{ pointerEvents: 'auto' }}>cell</span>
        </div>
      </div>
    );
  }

  /** The page's own height is declared per case; the row overflows sideways only. */
  function mountPage(pageScrolls: boolean, pointerEvents: 'auto' | 'none' = 'auto') {
    const { getByTestId } = render(<Page pointerEvents={pointerEvents} />);
    const page = getByTestId('page');
    const row = getByTestId('row');
    const geom = (el: HTMLElement, g: Record<string, number>) => {
      for (const [k, v] of Object.entries(g)) Object.defineProperty(el, k, { value: v, configurable: true });
    };
    geom(page, { scrollHeight: pageScrolls ? 900 : 300, clientHeight: 300 });
    geom(row, { scrollWidth: 600, clientWidth: 200, scrollHeight: 40, clientHeight: 40 });
    let left = 0;
    Object.defineProperty(row, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => { left = Math.max(0, Math.min(v, 400)); } });
    return { page, row, cell: getByTestId('cell') };
  }

  it('[UI-14] takes a vertical wheel on a row whose surface does not scroll', () => {
    const { row, cell } = mountPage(false);
    expect(wheel(cell, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(50);
  });

  it('[UI-14] leaves a vertical wheel to the page that scrolls around the row', () => {
    const { row, cell } = mountPage(true);
    expect(wheel(cell, { deltaY: 50 })).toBe(false);
    expect(row.scrollLeft).toBe(0);
  });

  it('[UI-14] leaves a sideways wheel to the browser over the row itself, page or not', () => {
    for (const pageScrolls of [false, true]) {
      const { row, cell } = mountPage(pageScrolls);
      expect(wheel(cell, { deltaX: 50 })).toBe(false);
      expect(row.scrollLeft).toBe(0);
      cleanup();
    }
  });

  it('[UI-14] scrolls a row inside a scrolling page sideways from its gap, and leaves the vertical wheel to the page', () => {
    const { page, row } = mountPage(true, 'none');
    const original = document.elementFromPoint;
    document.elementFromPoint = () => (row.style.pointerEvents === 'auto' ? row : page);
    onTestFinished(() => { document.elementFromPoint = original; });
    expect(wheel(page, { deltaY: 50 })).toBe(false);
    expect(row.scrollLeft).toBe(0);
    expect(wheel(page, { deltaX: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(50);
  });

  it('[UI-14] never takes a pinch, page or not', () => {
    for (const pageScrolls of [false, true]) {
      const { row, cell } = mountPage(pageScrolls);
      expect(wheel(cell, { deltaY: 50, ctrlKey: true })).toBe(false);
      expect(wheel(cell, { deltaX: 50, ctrlKey: true })).toBe(false);
      expect(row.scrollLeft).toBe(0);
      cleanup();
    }
  });

  it('[UI-14] a vertical wheel over a scroller inside the row is left to that scroller', () => {
    const { row, cell } = mountPage(false);
    cell.style.overflowY = 'auto';
    for (const [k, v] of Object.entries({ scrollHeight: 200, clientHeight: 40 })) Object.defineProperty(cell, k, { value: v, configurable: true });
    expect(wheel(cell, { deltaY: 50 })).toBe(false);
    expect(row.scrollLeft).toBe(0);
  });

  it('[UI-14] an ancestor that clips rather than scrolls does not keep the vertical wheel from the row', () => {
    const { page, row, cell } = mountPage(true);
    page.style.overflowY = 'hidden';
    expect(wheel(cell, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(50);
  });

  it('[UI-14] stray overflow at the page foot does not keep the vertical wheel from the row', () => {
    const { row, cell } = mountPage(false);
    const root = document.documentElement;
    for (const [k, v] of Object.entries({ scrollHeight: 5000, clientHeight: 800 })) Object.defineProperty(root, k, { value: v, configurable: true });
    onTestFinished(() => { delete (root as { scrollHeight?: number }).scrollHeight; delete (root as { clientHeight?: number }).clientHeight; });
    expect(wheel(cell, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(50);
  });

  it('[UI-14] a fixed row inside a scrolling page takes the vertical wheel, which cannot chain to that page', () => {
    const { row, cell } = mountPage(true);
    row.style.position = 'fixed';
    expect(wheel(cell, { deltaY: 50 })).toBe(true);
    expect(row.scrollLeft).toBe(50);
  });

  it('never travels a row that clips sideways rather than scrolling', () => {
    const { row, cell } = mountPage(false);
    row.style.overflowX = 'hidden';
    expect(wheel(cell, { deltaY: 50 })).toBe(false);
    expect(row.scrollLeft).toBe(0);
  });
});
