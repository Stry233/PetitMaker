// measureTarget names no particular target and is card-agnostic pure geometry.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { measureTarget } from '../../../ui/chrome/tour/measure';
import { tourTargetAttr } from '../../../ui/chrome/tour/steps';
import { poseLegacyZoom } from '../_legacy-zoom';

afterEach(cleanup);

describe('measureTarget', () => {
  it('returns null when the target is not on screen', () => {
    expect(measureTarget('bar')).toBeNull();
  });

  it('measures the marked element', () => {
    render(<div {...tourTargetAttr('bar')} />);
    const el = document.querySelector('[data-tour-target="bar"]') as HTMLElement;
    // jsdom gives every element a zero rect, so the value has to be supplied to assert on it.
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 30, height: 40, top: 20, left: 10, right: 40, bottom: 60, toJSON: () => ({}) }) as DOMRect;
    const rect = measureTarget('bar');
    expect(rect?.left).toBe(10);
    expect(rect?.width).toBe(30);
  });

  it('ignores an element with no size, which is one that has not laid out yet', () => {
    render(<div {...tourTargetAttr('menu')} />);
    expect(measureTarget('menu')).toBeNull();
  });
});

describe('measureTarget on an engine that measures zoomed subtrees in their own pixels', () => {
  it('reports the target in screen pixels', () => {
    render(<div data-testid="frame"><div {...tourTargetAttr('bar')} /></div>);
    const frame = document.querySelector('[data-testid="frame"]')!;
    const el = document.querySelector('[data-tour-target="bar"]') as HTMLElement;
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 30, height: 40, top: 20, left: 10, right: 40, bottom: 60, toJSON: () => ({}) }) as DOMRect;
    const restore = poseLegacyZoom((node) => (node === frame ? 0.5 : 1));
    try {
      const rect = measureTarget('bar');
      expect(rect?.left).toBe(5);
      expect(rect?.top).toBe(10);
      expect(rect?.width).toBe(15);
    } finally {
      restore();
    }
  });
});
