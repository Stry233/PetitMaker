// @vitest-environment jsdom
/** A camera glide drives the renderer it was handed, registered or not (a Help figure builds its
 *  own), and lands on the destination view. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { animateCamera, type CameraTweenHandle } from '../../../../view/map2d/camera/tween';
import type { MapRenderer } from '../../../../view/map2d/scene/map-renderer';

afterEach(() => { vi.useRealTimers(); });

describe('animateCamera', () => {
  it('glides an unregistered renderer to its target', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    let view = { zoom: 1, offsetX: 0, offsetY: 0 };
    const applied = vi.fn();
    const renderer = {
      viewport: { getView: () => ({ ...view }), setView: (v: typeof view) => { view = { ...v }; } },
      applyViewportTransform: applied,
    } as unknown as MapRenderer;
    const handle: CameraTweenHandle = { cancel: null };
    animateCamera(renderer, handle, (r) => r.viewport.setView({ zoom: 2, offsetX: 40, offsetY: -20 }));
    expect(view.zoom).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(view).toEqual({ zoom: 2, offsetX: 40, offsetY: -20 });
    expect(applied).toHaveBeenCalled();
  });
});
