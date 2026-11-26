// @vitest-environment jsdom
/**
 * Ctrl+wheel, a trackpad's pinch, zooms the map only where the point under the pointer reaches the
 * map: over the map itself or the pointer-transparent chrome above it, whose hit test falls through
 * to the map's host. Over a panel or a bar it leaves the map alone, and the page never zooms.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { setActiveView } from '../../../view/active-view';
import { MAP_HOST_ATTR } from '../../../view/interaction/map-wheel';
import type { ActiveView } from '../../../tools/pointer/runtime';

const zoomBy = vi.fn();
let map: HTMLElement;
let canvas: HTMLElement;
let panel: HTMLButtonElement;

beforeEach(() => {
  zoomBy.mockClear();
  map = document.createElement('div');
  map.setAttribute(MAP_HOST_ATTR, '');
  canvas = map.appendChild(document.createElement('canvas'));
  panel = document.createElement('button');
  document.body.append(map, panel);
  setActiveView({ camera: { zoomBy } } as unknown as ActiveView);
});
afterEach(() => {
  setActiveView(null);
  document.body.replaceChildren();
});

/** Dispatches a pinch at `target`; true when the page's own zoom was held off. */
function pinch(target: Element): boolean {
  const e = new WheelEvent('wheel', { deltaY: -20, ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('a pinch over the map or over a surface', () => {
  spec('UI-13', 'a pinch over the map zooms it', () => {
    expect(pinch(canvas)).toBe(true);
    expect(zoomBy).toHaveBeenCalledTimes(1);
  });

  spec('UI-13', 'a pinch over a panel or a bar leaves the map where it is, and the page unzoomed', () => {
    expect(pinch(panel)).toBe(true);
    expect(zoomBy).not.toHaveBeenCalled();
  });
});
