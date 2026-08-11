/**
 * The candidate picture.
 *
 * There is nothing here about what a map LOOKS like, and that is the point: the picture is taken by
 * the real 2D renderer over the candidate's own grid, so the colours, the trims and the icons are
 * the map's own and a test restating them would be a second opinion about one drawing. What is
 * still this module's own is the two things the capture cannot do for itself — refusing to invent a
 * picture where there is no renderer to take one, and centring what comes back in more sea when the
 * template is not the card's shape.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderThumbnail, seaFrame } from '../../canvas/thumbnail';
import { setMapRenderer } from '../../canvas/map2d/renderer-registry';
import type { MapRenderer } from '../../canvas/map2d/map-renderer';
import { makeState } from '../rules/_helpers';

afterEach(() => { setMapRenderer(null); });

describe('taking a candidate picture', () => {
  it('is nothing at all where there is no renderer to take it with', async () => {
    expect(await renderThumbnail(makeState(8, 8), 640, 2)).toBeNull();
  });

  it('is nothing at all where the renderer could not draw, rather than a broken picture', async () => {
    setMapRenderer({ captureState: async () => null } as unknown as MapRenderer);
    expect(await renderThumbnail(makeState(8, 8), 640, 2)).toBeNull();
  });

  it('remembers a grid\'s picture, and takes it once', async () => {
    let calls = 0;
    setMapRenderer({
      captureState: async () => { calls += 1; return { toDataURL: () => 'data:image/png;base64,x' }; },
    } as unknown as MapRenderer);
    const state = makeState(8, 8);
    expect(await renderThumbnail(state, 640)).toBe('data:image/png;base64,x');
    expect(await renderThumbnail(state, 640)).toBe('data:image/png;base64,x');
    expect(calls, 'the second ask is answered from memory').toBe(1);
    await renderThumbnail(state, 320);
    expect(calls, 'another size is another picture').toBe(2);
  });

  it('does not remember a missing renderer as the answer', async () => {
    const state = makeState(8, 8);
    expect(await renderThumbnail(state, 640)).toBeNull();
    setMapRenderer({
      captureState: async () => ({ toDataURL: () => 'data:image/png;base64,y' }),
    } as unknown as MapRenderer);
    expect(await renderThumbnail(state, 640), 'the renderer arrived, so the picture can now be taken').toBe('data:image/png;base64,y');
  });
});

describe('framing a map for a picture that is not its shape', () => {
  it('grows the short axis only, and centres the map in what it added', () => {
    expect(seaFrame(8, 8, 2)).toEqual({ width: 16, height: 8, dx: 4, dy: 0 });
  });

  it('grows the other axis for a picture taller than the map', () => {
    expect(seaFrame(8, 8, 0.5)).toEqual({ width: 8, height: 16, dx: 0, dy: 4 });
  });

  it('leaves a map already the picture shape exactly as it is', () => {
    expect(seaFrame(8, 8, 1)).toEqual({ width: 8, height: 8, dx: 0, dy: 0 });
  });

  it('never crops: the box holds the whole map on both axes, at any shape', () => {
    for (const aspect of [0.3, 0.75, 1, 1.706, 4]) {
      const box = seaFrame(169, 140, aspect);
      expect(box.width).toBeGreaterThanOrEqual(169);
      expect(box.height).toBeGreaterThanOrEqual(140);
      expect(box.width / box.height).toBeCloseTo(aspect, 1);
    }
  });
});
