// @vitest-environment jsdom
/**
 * The loupe's geometry: its circle stays whole inside the viewport wherever the finger is, and the
 * pixels it keeps are read only from inside the source canvas, each landing where it would have, so
 * the magnified map stays registered to the finger at the canvas edges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideLoupe, LOUPE, LOUPE_OUTER, loupeCentre, loupeFramePainted, paintLoupe, showLoupe, type LoupeSource } from '../../../../view/shared/overlay/loupe';

/** How far the kept pixels reach from the finger, in layout px: what the circle shows and a radius more. */
const KEPT = LOUPE.radius / LOUPE.zoom + LOUPE.radius;

/** Every `drawImage` call with nine arguments, as [sx, sy, sw, sh, dx, dy, dw, dh]. */
let draws: [number, number, number, number, number, number, number, number][];
/** Every `drawImage` call's source and its numbers. */
let images: { src: unknown; args: number[] }[];

function sourceOf(width: number, height: number, cssWidth: number, cssHeight: number): LoupeSource {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: cssWidth, bottom: cssHeight, width: cssWidth, height: cssHeight, toJSON: () => ({}),
  });
  return { canvas, requestFrame: () => {} };
}

beforeEach(() => {
  draws = [];
  images = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    clearRect: () => {},
    drawImage: (src: unknown, ...args: [number, number, number, number, number, number, number, number]) => {
      images.push({ src, args });
      if (args.length === 8) draws.push(args);
    },
  }) as never);
});

afterEach(() => {
  hideLoupe();
  vi.restoreAllMocks();
});

describe('the loupe', () => {
  it('keeps its whole circle inside the viewport on every side', () => {
    const src = sourceOf(100, 100, 100, 100);
    const { innerWidth: w, innerHeight: h } = window;
    showLoupe(src, { x: 2, y: 400 });
    expect(loupeCentre()!.x).toBe(LOUPE_OUTER);
    showLoupe(src, { x: w - 2, y: 400 });
    expect(loupeCentre()!.x).toBe(w - LOUPE_OUTER);
    showLoupe(src, { x: 300, y: 10 });
    expect(loupeCentre()!.y).toBe(LOUPE_OUTER);
    showLoupe(src, { x: 300, y: h + LOUPE.lift });
    expect(loupeCentre()!.y).toBe(h - LOUPE_OUTER);
    showLoupe(src, { x: 300, y: 400 });
    expect(loupeCentre()).toEqual({ x: 300, y: 400 - LOUPE.lift });
  });

  it('reads only inside the source near its edges, each pixel landing where it would have', () => {
    const src = sourceOf(200, 200, 100, 100);
    for (const at of [{ x: 3, y: 50 }, { x: 97, y: 50 }, { x: 50, y: 2 }, { x: 99, y: 99 }]) {
      draws = [];
      showLoupe(src, at);
      loupeFramePainted(src);
      expect(draws).toHaveLength(1);
      const [sx, sy, sw, sh, dx, dy, dw, dh] = draws[0]!;
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + sw).toBeLessThanOrEqual(200);
      expect(sy + sh).toBeLessThanOrEqual(200);
      expect([dw, dh]).toEqual([sw, sh]);
      // Clipping moves the read and the landing together: what lands at 0 is still the kept
      // square's corner, `KEPT` layout px up and left of the finger, at 2 source px per layout px.
      expect(sx - dx).toBeCloseTo(2 * (at.x - KEPT));
      expect(sy - dy).toBeCloseTo(2 * (at.y - KEPT));
    }
  });

  it('paints from the kept pixels only inside them, registered to a finger that moved past them', () => {
    const src = sourceOf(200, 200, 100, 100);
    const kept = { x: 50, y: 50 };
    showLoupe(src, kept);
    loupeFramePainted(src);
    // The finger moves on with no frame drawn since: part of what the circle shows was never kept.
    const at = { x: 50 + KEPT - 10, y: 50 };
    showLoupe(src, at);
    draws = [];
    paintLoupe(document.createElement('canvas'), 2);
    expect(draws).toHaveLength(1);
    const [sx, sy, sw, sh, dx, dy, dw, dh] = draws[0]!;
    const keptSide = Math.ceil(2 * KEPT * 2);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx + sw).toBeLessThanOrEqual(keptSide);
    expect(sy + sh).toBeLessThanOrEqual(keptSide);
    // 2 source px per layout px, painted at 2 device px per magnified layout px: k device px per source px.
    const k = (2 * LOUPE.radius * 2) / (2 * (LOUPE.radius / LOUPE.zoom) * 2);
    expect([dw / sw, dh / sh]).toEqual([k, k]);
    const seen = LOUPE.radius / LOUPE.zoom;
    expect(sx - dx / k).toBeCloseTo(2 * (at.x - seen - (kept.x - KEPT)));
    expect(sy - dy / k).toBeCloseTo(2 * (at.y - seen - (kept.y - KEPT)));
  });

  it('shows a source\'s own drawing of the square, asked for at the loupe\'s device pixels', () => {
    const drawing = document.createElement('canvas');
    const asked: { region: { x: number; y: number; side: number }; outPx: number }[] = [];
    const src: LoupeSource = { ...sourceOf(200, 200, 100, 100), renderRegion: (region, outPx) => { asked.push({ region, outPx }); return drawing; } };
    const target = document.createElement('canvas');
    showLoupe(src, { x: 50, y: 50 });
    // The first paint at this density asks for a frame drawn to it.
    paintLoupe(target, 3);
    loupeFramePainted(src);
    images = [];
    paintLoupe(target, 3);
    const side = Math.round(2 * LOUPE.radius * 3);
    const seen = LOUPE.radius / LOUPE.zoom;
    expect(asked.at(-1)).toEqual({ region: { x: 50 - seen, y: 50 - seen, side: 2 * seen }, outPx: side });
    expect(images).toEqual([{ src: drawing, args: [0, 0, side, side] }]);
  });

  it('falls back to the frame\'s own pixels when the source cannot draw the square', () => {
    const src: LoupeSource = { ...sourceOf(200, 200, 100, 100), renderRegion: () => null };
    showLoupe(src, { x: 50, y: 50 });
    loupeFramePainted(src);
    draws = [];
    paintLoupe(document.createElement('canvas'), 2);
    expect(draws).toHaveLength(1);
    const k = (2 * LOUPE.radius * 2) / (2 * (LOUPE.radius / LOUPE.zoom) * 2);
    expect([draws[0]![6] / draws[0]![2], draws[0]![7] / draws[0]![3]]).toEqual([k, k]);
  });
});
