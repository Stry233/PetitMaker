// The letterbox math that frames a captured map for a provider's aspect grid, and the inverse
// crop that recovers the illustrated region from whatever resolution the provider actually
// returns. Pure geometry: no store, no network.
import { describe, it, expect, vi } from 'vitest';
import { planNormalize, cropBackRect, letterboxToCanvas, type AspectOption } from '../../../io/stylize/normalize';

// A provider aspect grid kept local so nearest-aspect behavior is tested independently of the
// dialects module.
const GEMINI_ASPECTS: AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '2:3', ratio: 2 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '5:4', ratio: 5 / 4 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '21:9', ratio: 21 / 9 },
];

describe('planNormalize', () => {
  it('picks the nearest aspect by orientation-aware log-ratio distance (5:4 over 4:3)', () => {
    const plan = planNormalize(10848, 8992, 1536, GEMINI_ASPECTS);
    expect(plan.aspectId).toBe('5:4');
  });

  it('preserves the source aspect ratio in drawW/drawH to within one part in a thousand', () => {
    const srcW = 10848;
    const srcH = 8992;
    const plan = planNormalize(srcW, srcH, 1536, GEMINI_ASPECTS);
    const srcRatio = srcW / srcH;
    const drawRatio = plan.drawW / plan.drawH;
    expect(Math.abs(drawRatio / srcRatio - 1)).toBeLessThan(1e-3);
  });

  it('centers the draw rect inside the frame exactly', () => {
    const plan = planNormalize(10848, 8992, 1536, GEMINI_ASPECTS);
    expect(plan.offsetX).toBeCloseTo((plan.frameW - plan.drawW) / 2, 6);
    expect(plan.offsetY).toBeCloseTo((plan.frameH - plan.drawH) / 2, 6);
  });

  it('never upscales: a source smaller than the frame shrinks the frame to the source scale', () => {
    const plan = planNormalize(100, 100, 1536, [{ id: '1:1', ratio: 1 }]);
    expect(plan.drawW).toBeCloseTo(100, 6);
    expect(plan.drawH).toBeCloseTo(100, 6);
    expect(plan.frameW).toBeCloseTo(100, 6);
    expect(plan.frameH).toBeCloseTo(100, 6);
    expect(plan.offsetX).toBeCloseTo(0, 6);
    expect(plan.offsetY).toBeCloseTo(0, 6);
  });

  it('a portrait source picks a portrait aspect', () => {
    const plan = planNormalize(900, 1600, 1536, GEMINI_ASPECTS);
    const picked = GEMINI_ASPECTS.find((a) => a.id === plan.aspectId)!;
    expect(picked.ratio).toBeLessThan(1);
  });
});

describe('cropBackRect', () => {
  it('scales the inner draw rect proportionally to the provider\'s actual output size', () => {
    const plan = planNormalize(1200, 800, 1536, GEMINI_ASPECTS);
    const rect2x = cropBackRect(plan, plan.frameW * 2, plan.frameH * 2);
    expect(rect2x.x).toBeCloseTo(plan.offsetX * 2, 6);
    expect(rect2x.y).toBeCloseTo(plan.offsetY * 2, 6);
    expect(rect2x.w).toBeCloseTo(plan.drawW * 2, 6);
    expect(rect2x.h).toBeCloseTo(plan.drawH * 2, 6);
  });

  it('is the identity at 1x output', () => {
    const plan = planNormalize(1200, 800, 1536, GEMINI_ASPECTS);
    const rect = cropBackRect(plan, plan.frameW, plan.frameH);
    expect(rect).toEqual({ x: plan.offsetX, y: plan.offsetY, w: plan.drawW, h: plan.drawH });
  });
});

describe('letterboxToCanvas', () => {
  it('fills the paper color then draws the source centered at the plan rect', () => {
    const calls: { fillStyle?: unknown; fillRect?: number[]; drawImage?: unknown[] }[] = [];
    const fakeCtx = {
      set fillStyle(v: unknown) { calls.push({ fillStyle: v }); },
      fillRect: (x: number, y: number, w: number, h: number) => calls.push({ fillRect: [x, y, w, h] }),
      drawImage: (...args: unknown[]) => calls.push({ drawImage: args }),
    } as unknown as CanvasRenderingContext2D;
    const ctxSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as never);

    const plan = planNormalize(1200, 800, 1536, GEMINI_ASPECTS);
    const img = {} as CanvasImageSource;
    const canvas = letterboxToCanvas(img, plan, '#F7F5EC');

    expect(canvas.width).toBe(Math.round(plan.frameW));
    expect(canvas.height).toBe(Math.round(plan.frameH));
    const fillIdx = calls.findIndex((c) => 'fillStyle' in c);
    const rectIdx = calls.findIndex((c) => 'fillRect' in c);
    const drawIdx = calls.findIndex((c) => 'drawImage' in c);
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(calls[fillIdx]!.fillStyle).toBe('#F7F5EC');
    expect(rectIdx).toBeGreaterThan(fillIdx);
    expect(calls[rectIdx]!.fillRect).toEqual([0, 0, plan.frameW, plan.frameH]);
    expect(drawIdx).toBeGreaterThan(rectIdx);
    expect(calls[drawIdx]!.drawImage).toEqual([img, plan.offsetX, plan.offsetY, plan.drawW, plan.drawH]);

    ctxSpy.mockRestore();
  });
});
