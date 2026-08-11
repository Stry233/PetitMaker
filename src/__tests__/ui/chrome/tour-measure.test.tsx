// measureTarget names no particular target and is card-agnostic pure geometry.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { measureTarget } from '../../../ui/chrome/tour/measure';
import { tourTargetAttr } from '../../../ui/chrome/tour/steps';

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
