import { vi } from 'vitest';
import { __resetVisualRectProbe } from '../../ui/design/visual-rect';

const PROBE = {
  x: 0, y: 0, left: 0, top: 0, width: 200, height: 10, right: 200, bottom: 10, toJSON: () => ({}),
} as DOMRect;

/**
 * Poses an engine that reports a zoomed subtree's rects in its own CSS pixels. Elements with their
 * own `getBoundingClientRect` stub keep it; every other element reads the legacy probe width.
 * `zoomOf` answers each element's own computed `zoom`. Returns the restore function.
 */
export function poseLegacyZoom(zoomOf: (el: Element) => number): () => void {
  __resetVisualRectProbe();
  const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => PROBE);
  const real = window.getComputedStyle.bind(window);
  const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo);
    return new Proxy(style, {
      get: (target, key) => {
        if (key === 'zoom') return String(zoomOf(el));
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  return () => {
    rectSpy.mockRestore();
    styleSpy.mockRestore();
    __resetVisualRectProbe();
  };
}
