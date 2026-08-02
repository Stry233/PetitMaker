/**
 * The map's scale is the user's, not the browser's.
 *
 * `zoom` and the offsets are CSS px, and page zoom redefines the CSS px — so the same numbers draw
 * a bigger map at 110%. The 3D view has no such problem (its canvas covers the same device pixels
 * either way), so leaving 2D exposed made the two views disagree about how big the world is.
 */
import { describe, it, expect } from 'vitest';
import { Viewport } from '../../canvas/map2d/viewport';

/** Physical size of one world unit: css-per-world x device-per-css. */
const physical = (vp: Viewport, dpr: number) => vp.getZoom() * dpr;

describe('rebaseForPageZoom', () => {
  it('holds the map at one physical size when the page is zoomed IN', () => {
    const vp = new Viewport(1000, 800);
    vp.fitToMap(40, 30);
    const before = physical(vp, 1);
    vp.rebaseForPageZoom(1.1);          // 100% -> 110%: dpr rises by the same ratio
    expect(physical(vp, 1.1)).toBeCloseTo(before, 10);
  });

  it('and when it is zoomed OUT', () => {
    const vp = new Viewport(1000, 800);
    vp.fitToMap(40, 30);
    const before = physical(vp, 1);
    vp.rebaseForPageZoom(0.8);
    expect(physical(vp, 0.8)).toBeCloseTo(before, 10);
  });

  it('keeps the same world point under the same PHYSICAL screen position', () => {
    // Not just the scale: the framing has to survive too, or the map jumps as it resizes.
    const vp = new Viewport(1000, 800);
    vp.fitToMap(40, 30);
    const worldBefore = vp.screenToWorld(400, 300);
    vp.rebaseForPageZoom(1.25);
    // The same physical point is at 1/1.25 of the css coordinate after the zoom.
    const worldAfter = vp.screenToWorld(400 / 1.25, 300 / 1.25);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('does nothing for a ratio of 1, so an ordinary window resize rebases nothing', () => {
    const vp = new Viewport(1000, 800);
    vp.fitToMap(40, 30);
    const z = vp.getZoom(); const o = vp.getOffset();
    vp.rebaseForPageZoom(1);
    expect(vp.getZoom()).toBe(z);
    expect(vp.getOffset()).toEqual(o);
  });

  it('ignores a nonsense ratio rather than destroying the camera', () => {
    const vp = new Viewport(1000, 800);
    vp.fitToMap(40, 30);
    const z = vp.getZoom();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) vp.rebaseForPageZoom(bad);
    expect(vp.getZoom()).toBe(z);
  });

  it('composes across successive steps, so zoom out and back returns where it started', () => {
    const vp = new Viewport(1000, 800);
    vp.fitToMap(40, 30);
    const z = vp.getZoom();
    vp.rebaseForPageZoom(1.25);
    vp.rebaseForPageZoom(1 / 1.25);
    expect(vp.getZoom()).toBeCloseTo(z, 10);
  });
});
