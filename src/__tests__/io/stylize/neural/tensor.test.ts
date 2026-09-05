import { describe, expect, it } from 'vitest';
import { modelSize, rgbaToTensor, tensorToRgba } from '../../../../io/stylize/neural/tensor';
import { NEURAL_ASPECTS, NEURAL_MAX_EDGE } from '../../../../io/stylize/neural/session';
import { planNormalize } from '../../../../io/stylize/normalize';
import { PROC_PACK_META } from '../../../../io/stylize/proc/packs/manifest';
import { MODEL_URLS } from '../../../../io/stylize/neural/models';

describe('neural tensor packing', () => {
  it('trims the frame to multiples of 8 and never below 8', () => {
    expect(modelSize(1536, 1152)).toEqual({ width: 1536, height: 1152 });
    expect(modelSize(1537, 1159)).toEqual({ width: 1536, height: 1152 });
    expect(modelSize(3, 5)).toEqual({ width: 8, height: 8 });
  });

  it('round-trips RGB through the planar float layout and drops alpha', () => {
    const w = 3, h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = i * 40; rgba[i * 4 + 1] = 255 - i * 40; rgba[i * 4 + 2] = 7 * i; rgba[i * 4 + 3] = 3;
    }
    const t = rgbaToTensor(rgba, w, { width: w, height: h });
    expect(t.length).toBe(3 * w * h);
    expect(t[0]).toBe(0);
    expect(t[w * h]).toBeCloseTo(1);
    const back = tensorToRgba(t, { width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      expect(back[i * 4]).toBe(rgba[i * 4]);
      expect(back[i * 4 + 1]).toBe(rgba[i * 4 + 1]);
      expect(back[i * 4 + 2]).toBe(rgba[i * 4 + 2]);
      expect(back[i * 4 + 3]).toBe(255);
    }
  });

  it('reads the top-left region of a wider source row', () => {
    const rgba = new Uint8ClampedArray(4 * 1 * 4);
    rgba.set([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]);
    const t = rgbaToTensor(rgba, 4, { width: 2, height: 1 });
    expect(Array.from(t.slice(0, 2)).map((v) => Math.round(v * 255))).toEqual([10, 20]);
  });

  it('clamps model overshoot into bytes', () => {
    const back = tensorToRgba(new Float32Array([1.3, -0.2, 0.5]), { width: 1, height: 1 });
    expect(Array.from(back)).toEqual([255, 0, 128, 255]);
  });
});

describe('the model frame', () => {
  it('is the training frame: longest edge 1536 in one of the five gateway aspects', () => {
    const plan = planNormalize(2400, 1800, NEURAL_MAX_EDGE, NEURAL_ASPECTS);
    expect(plan.frameW).toBe(1536);
    expect(plan.aspectId).toBe('4:3');
    expect(NEURAL_ASPECTS.map((a) => a.id)).toEqual(['1:1', '3:4', '4:3', '9:16', '16:9']);
  });

  it('has a weights file behind every neural pack', () => {
    const neural = PROC_PACK_META.filter((m) => m.neural);
    expect(neural.length).toBe(5);
    for (const m of neural) expect(typeof MODEL_URLS[m.neural!]).toBe('string');
  });
});

describe('the take variation', () => {
  it('is the plain framing for seed 0 and deterministic otherwise', async () => {
    const { variationFor } = await import('../../../../io/stylize/neural/variation');
    expect(variationFor(0)).toEqual({ flipX: false, flipY: false, scale: 1, shiftX: 0.5, shiftY: 0.5 });
    expect(variationFor(12345)).toEqual(variationFor(12345));
    expect(variationFor(12345)).not.toEqual(variationFor(12346));
  });

  it('keeps the map inside the frame: scale in [0.94, 1), shifts in [0, 1)', async () => {
    const { variationFor } = await import('../../../../io/stylize/neural/variation');
    let flips = 0;
    for (let s = 1; s <= 500; s++) {
      const v = variationFor(s * 7919);
      expect(v.scale).toBeGreaterThanOrEqual(0.94);
      expect(v.scale).toBeLessThan(1);
      for (const x of [v.shiftX, v.shiftY]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
      if (v.flipX) flips++;
    }
    expect(flips).toBeGreaterThan(150);
    expect(flips).toBeLessThan(350);
  });
});
