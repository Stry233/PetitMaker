// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { observeScrollGeometry } from '../../../ui/primitives/scroll-geometry';

afterEach(() => vi.unstubAllGlobals());

it('shares viewport and child observation until the last consumer leaves', () => {
  const observe = vi.fn(), disconnect = vi.fn(), constructed = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor() { constructed(); }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
  });
  const viewport = document.createElement('div'), content = document.createElement('div');
  viewport.append(content);
  const fade = observeScrollGeometry(viewport, vi.fn());
  const follow = observeScrollGeometry(viewport, vi.fn());
  expect(constructed).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledWith(viewport);
  expect(observe).toHaveBeenCalledWith(content);
  fade();
  expect(disconnect).not.toHaveBeenCalled();
  follow();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('reports late intrinsic media growth without a scroll or React render', () => {
  const viewport = document.createElement('div'), image = document.createElement('img');
  viewport.append(image);
  const listener = vi.fn();
  const stop = observeScrollGeometry(viewport, listener);
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 500 });
  image.dispatchEvent(new Event('load'));
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ scrollHeight: 500 }), 'content');
  stop();
});
