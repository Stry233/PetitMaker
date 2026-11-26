// @vitest-environment jsdom
/** A camera glide drives the renderer it was handed, registered or not (a Help figure builds its
 *  own), along its ease-out over the registry duration on that renderer's frame loop, and lands on
 *  the destination view. */
import { describe, expect, it, vi } from 'vitest';
import { animateCamera, type CameraTweenHandle } from '../../../../view/map2d/camera/tween';
import type { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { animConfig, easeOutCubic } from '../../../../view/shared/motion/anim-config';
import { beatClock } from '../../../_support/beat-clock';

describe('animateCamera', () => {
  it('glides an unregistered renderer to its target', () => {
    let view = { zoom: 1, offsetX: 0, offsetY: 0, heading: 0 };
    const applied = vi.fn();
    const loop = beatClock();
    const renderer = {
      viewport: { getView: () => ({ ...view }), setView: (v: typeof view) => { view = { ...v }; } },
      applyViewportTransform: applied,
      play: loop.play,
    } as unknown as MapRenderer;
    const handle: CameraTweenHandle = { cancel: null };
    animateCamera(renderer, handle, (r) => r.viewport.setView({ zoom: 2, offsetX: 40, offsetY: -20, heading: 0 }));
    expect(view.zoom).toBe(1);
    const ms = animConfig.cameraGlide.map2dMs;
    loop.frame(500);
    loop.frame(500 + ms / 2);
    expect(view.zoom).toBeCloseTo(1 + easeOutCubic(0.5), 9);
    expect(loop.frame(500 + ms)).toBe(false);
    expect(view).toEqual({ zoom: 2, offsetX: 40, offsetY: -20, heading: 0 });
    expect(applied).toHaveBeenCalled();
  });
});
