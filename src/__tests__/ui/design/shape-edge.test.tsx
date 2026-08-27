import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ShapeEdge, isWebKitEngine, __clearShapeEdgeProbe } from '../../../ui/design/shape-edge';
import { INK, MAP_EDGE_ALPHA, MAP_SHAPE_EDGE, plateShapeEdge } from '../../../ui/design/tokens';

/**
 * The hairline is drawn three ways for one look: the dilation filter as-is on Blink and Gecko, the
 * same filter over a double-size copy scaled back down on WebKit (which draws the filter's band
 * about twice as wide and soft as the others), and a spread-only ring where the silhouette is the
 * border-radius box itself. These tests pin the seams: which engines get which markup, and that
 * the ring carries the family's ink at every screen density.
 */

function standIn(webkit: boolean): ReturnType<typeof vi.fn> {
  __clearShapeEdgeProbe();
  const supports = vi.fn((prop: string) => webkit && String(prop).startsWith('-webkit-nbsp-mode'));
  vi.stubGlobal('CSS', { supports });
  return supports;
}

afterEach(() => {
  vi.unstubAllGlobals();
  __clearShapeEdgeProbe();
  cleanup();
});

describe('the engine probe', () => {
  it('answers WebKit only where -webkit-nbsp-mode parses', () => {
    standIn(true);
    expect(isWebKitEngine()).toBe(true);
    standIn(false);
    expect(isWebKitEngine()).toBe(false);
  });

  it('is memoised: the engine cannot change under a running page', () => {
    const supports = standIn(true);
    expect(isWebKitEngine()).toBe(true);
    supports.mockReturnValue(false);
    expect(isWebKitEngine()).toBe(true);
  });
});

describe('ShapeEdge', () => {
  it('outside WebKit, the filter sits on the box itself and nothing is doubled', () => {
    standIn(false);
    const { container } = render(<ShapeEdge style={{ width: 40, height: 20 }}><i /></ShapeEdge>);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.filter).toBe(MAP_SHAPE_EDGE);
    expect(box.querySelector('i')?.parentElement).toBe(box);
  });

  it('on WebKit, the filter runs over a double-size copy scaled back to the box', () => {
    standIn(true);
    const { container } = render(<ShapeEdge style={{ width: 40, height: 20 }}><i /></ShapeEdge>);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.filter).toBe('');
    const middle = box.firstElementChild as HTMLElement;
    expect(middle.style.filter).toBe(MAP_SHAPE_EDGE);
    expect(middle.style.width).toBe('200%');
    expect(middle.style.height).toBe('200%');
    expect(middle.style.transform).toBe('scale(0.5)');
    expect(middle.style.transformOrigin).toBe('top left');
    expect(box.querySelector('i')?.parentElement).toBe(middle);
  });

  it('is decoration whichever way it is drawn: hidden from readers, transparent to the pointer', () => {
    for (const webkit of [false, true]) {
      standIn(webkit);
      const { container, unmount } = render(<ShapeEdge><i /></ShapeEdge>);
      const box = container.firstElementChild as HTMLElement;
      expect(box.getAttribute('aria-hidden')).toBe('true');
      expect(box.style.pointerEvents).toBe('none');
      unmount();
    }
  });
});

describe('plateShapeEdge', () => {
  const withDpr = (dpr: number, run: () => void) => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
    try { run(); } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
    }
  };
  const hex = (alpha: number) => Math.round(alpha * 255).toString(16).padStart(2, '0');

  it('on a dense screen: half a px of the family ink, one crisp device row', () => {
    withDpr(2, () => expect(plateShapeEdge()).toBe(`0 0 0 0.5px ${INK}${hex(MAP_EDGE_ALPHA)}`));
  });

  it('on a 1x screen: a full px carrying half the ink, since WebKit drops a half-px ring there', () => {
    withDpr(1, () => expect(plateShapeEdge()).toBe(`0 0 0 1px ${INK}${hex(MAP_EDGE_ALPHA / 2)}`));
  });

  it('is a ring and not a shadow: no offset, no blur', () => {
    for (const dpr of [1, 2]) {
      withDpr(dpr, () => expect(plateShapeEdge()).toMatch(/^0 0 0 /));
    }
  });
});
