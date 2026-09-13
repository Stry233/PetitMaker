/**
 * The candidate picture.
 *
 * There is nothing here about what a map LOOKS like, and that is the point: the picture is taken by
 * the real 2D renderer over the candidate's own grid, so the colours, the trims and the icons are
 * the map's own and a test restating them would be a second opinion about one drawing. What is
 * still this module's own is what the capture cannot do for itself — refusing to invent a picture
 * where there is no renderer to take one, choosing the cells a card is framed on when a painted
 * region is what the run applies to, and centring what comes back in more sea when that frame is
 * not the card's shape.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { focusFrame, renderThumbnail, seaFrame } from '../../canvas/thumbnail';
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

  it('evicts its oldest picture past a bound, rather than growing one PNG per version forever', async () => {
    let calls = 0;
    setMapRenderer({
      captureState: async () => { calls += 1; return { toDataURL: () => `data:image/png;base64,${calls}` }; },
    } as unknown as MapRenderer);
    const state = makeState(8, 8);

    // One more than the cap, each its own version: a live card re-photographing a map that keeps
    // moving, the way a session's whole life would without a bound.
    const shots: (string | null)[] = [];
    for (let v = 1; v <= 13; v++) {
      // eslint-disable-next-line no-await-in-loop
      shots.push(await renderThumbnail(state, 640, undefined, null, v));
    }
    expect(calls, 'every version is its own capture the first time').toBe(13);

    // The most recent ones are still remembered...
    expect(await renderThumbnail(state, 640, undefined, null, 13)).toBe(shots[12]);
    expect(calls, 'answered from memory').toBe(13);

    // ...but the very first has aged out, and asking for it again takes a fresh picture.
    await renderThumbnail(state, 640, undefined, null, 1);
    expect(calls, 'the oldest picture had already been evicted').toBe(14);
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

describe('framing a picture on the region a run is bounded by', () => {
  const CARD = 568 / 333;
  const template = { width: 169, height: 140 };
  const box = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, width, height });
  const holds = (frame: { x: number; y: number; width: number; height: number }, b: ReturnType<typeof box>): boolean =>
    frame.x <= b.origin.x && frame.y <= b.origin.y
    && frame.x + frame.width >= b.origin.x + b.width
    && frame.y + frame.height >= b.origin.y + b.height;

  it('zooms to a small region, with air around it and the card\'s own shape', () => {
    const painted = box(20, 30, 12, 9);
    const frame = focusFrame(painted, template, CARD)!;
    expect(frame).not.toBeNull();
    expect(holds(frame, painted), 'the whole region is in the picture').toBe(true);
    expect(frame.width / frame.height).toBeCloseTo(CARD, 1);
    expect(frame.width, 'and it is a fraction of the island').toBeLessThan(template.width / 2);
  });

  it('keeps the frame inside the map, wherever the region was painted', () => {
    for (const painted of [box(0, 0, 6, 6), box(163, 134, 6, 6), box(0, 68, 6, 6)]) {
      const frame = focusFrame(painted, template, CARD)!;
      expect(holds(frame, painted)).toBe(true);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(template.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(template.height);
    }
  });

  it('leaves a region that is most of the island framed as the island', () => {
    expect(focusFrame(box(4, 4, 150, 120), template, CARD)).toBeNull();
  });

  it('is the whole map where nothing is painted', () => {
    expect(focusFrame(null, template, CARD)).toBeNull();
    expect(focusFrame(box(1, 1, 4, 4), null, CARD)).toBeNull();
  });

  it('is another picture of the same grid, taken and remembered on its own', async () => {
    const framed: (unknown | undefined)[] = [];
    setMapRenderer({
      captureState: async (_s: unknown, _px: number, frame?: unknown) => {
        framed.push(frame);
        return { toDataURL: () => 'data:image/png;base64,z' };
      },
    } as unknown as MapRenderer);
    const state = makeState(8, 8);
    const frame = { x: 1, y: 1, width: 4, height: 3 };
    await renderThumbnail(state, 640, undefined, frame);
    await renderThumbnail(state, 640, undefined, frame);
    expect(framed).toEqual([frame]);
    await renderThumbnail(state, 640, undefined, null);
    expect(framed, 'the whole map is not the framed picture').toEqual([frame, undefined]);
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

 it('shares simultaneous captures of the same map version', async () => {
    let captures = 0;
    setMapRenderer({ captureState: async () => {
      captures++;
      return { toDataURL: () => 'data:image/png;base64,shared' };
    } } as unknown as MapRenderer);
    const state = makeState(8, 8);
    const images = await Promise.all(Array.from({ length: 8 }, () => renderThumbnail(state, 640)));
    expect(captures).toBe(1);
    expect(new Set(images).size).toBe(1);
  });
