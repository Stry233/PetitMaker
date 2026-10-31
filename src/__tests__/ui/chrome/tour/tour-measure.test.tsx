// @vitest-environment jsdom
// measureTargets names no particular target and is pure geometry over the marked elements.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { measureTargets } from '../../../../ui/chrome/tour/measure';
import { tourTargetAttr } from '../../../../ui/chrome/tour/steps';
import { poseLegacyZoom } from '../../../_support/legacy-zoom';

afterEach(cleanup);

describe('measureTargets', () => {
  it('returns null when the target is not on screen', () => {
    expect(measureTargets(['bar'])).toBeNull();
  });

  it('measures the marked element', () => {
    render(<div {...tourTargetAttr('bar')} />);
    const el = document.querySelector('[data-tour-target="bar"]') as HTMLElement;
    // jsdom gives every element a zero rect, so the value has to be supplied to assert on it.
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 30, height: 40, top: 20, left: 10, right: 40, bottom: 60, toJSON: () => ({}) }) as DOMRect;
    const rect = measureTargets(['bar']);
    expect(rect?.left).toBe(10);
    expect(rect?.width).toBe(30);
  });

  it('ignores an element with no size, which is one that has not laid out yet', () => {
    render(<div {...tourTargetAttr('menu')} />);
    expect(measureTargets(['menu'])).toBeNull();
  });
});

describe('measureTargets on an engine that measures zoomed subtrees in their own pixels', () => {
  it('reports the target in screen pixels', () => {
    render(<div data-testid="frame"><div {...tourTargetAttr('bar')} /></div>);
    const frame = document.querySelector('[data-testid="frame"]')!;
    const el = document.querySelector('[data-tour-target="bar"]') as HTMLElement;
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 30, height: 40, top: 20, left: 10, right: 40, bottom: 60, toJSON: () => ({}) }) as DOMRect;
    const restore = poseLegacyZoom((node) => (node === frame ? 0.5 : 1));
    try {
      const rect = measureTargets(['bar']);
      expect(rect?.left).toBe(5);
      expect(rect?.top).toBe(10);
      expect(rect?.width).toBe(15);
    } finally {
      restore();
    }
  });
});

describe('measureTargets over several targets', () => {
  it('rings the box around every target shown, and skips one that is not', () => {
    render(<><div {...tourTargetAttr('brush')} /><div {...tourTargetAttr('eraser')} /><div {...tourTargetAttr('add-layer')} /></>);
    const at = (id: string, left: number, top: number) => {
      (document.querySelector(`[data-tour-target="${id}"]`) as HTMLElement).getBoundingClientRect = () =>
        ({ x: left, y: top, width: 20, height: 10, top, left, right: left + 20, bottom: top + 10, toJSON: () => ({}) }) as DOMRect;
    };
    at('brush', 10, 50);
    at('eraser', 40, 60);
    expect(measureTargets(['brush', 'eraser', 'add-layer'])).toEqual({ left: 10, top: 50, width: 50, height: 20 });
  });

  it('points at the first carrier on screen when several elements carry one target', () => {
    render(<><div data-testid="a" {...tourTargetAttr('shelf-card')} /><div data-testid="b" {...tourTargetAttr('shelf-card')} /></>);
    const [a, b] = [...document.querySelectorAll('[data-tour-target="shelf-card"]')] as HTMLElement[];
    a!.getBoundingClientRect = () => ({ x: -200, y: 0, width: 40, height: 40, top: 0, left: -200, right: -160, bottom: 40, toJSON: () => ({}) }) as DOMRect;
    b!.getBoundingClientRect = () => ({ x: 30, y: 0, width: 40, height: 40, top: 0, left: 30, right: 70, bottom: 40, toJSON: () => ({}) }) as DOMRect;
    expect(measureTargets(['shelf-card'])?.left).toBe(30);
  });
});
