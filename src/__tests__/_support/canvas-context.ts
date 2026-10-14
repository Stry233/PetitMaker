/*
 * jsdom has no 2D canvas context. A test that needs one hands `getContext` the few members its
 * code path calls; every canvas then returns that same object until the spy is restored.
 */
import { vi } from 'vitest';

/** Make every canvas's `getContext` return `context`. Returns the spy so a test can restore it or read its calls. */
export function stubCanvasContext(context: object) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as ReturnType<HTMLCanvasElement['getContext']>);
}
