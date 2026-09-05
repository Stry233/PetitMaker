import { describe, expect, it } from 'vitest';
import { emojiTextDrawing, fitEmojiDrawing } from '../../../../tools/generation/stencil/stencil-emoji-mask';
import { textTopology } from '../../../../tools/generation/stencil/stencil-text-grid';
import { FACE, HEART, pixels } from './_stencil-art';

describe('emoji text drawing', () => {
  it('keeps eyes and a mouth as negative space in a filled face', () => {
    const model = emojiTextDrawing(pixels(FACE, 6));
    expect(model.details.length).toBeGreaterThanOrEqual(3);
    for (const [width, height] of [[5, 5], [5, 6], [6, 5], [8, 8], [16, 16], [32, 32]]) {
      const result = fitEmojiDrawing(model, { width: width!, height: height! })!;
      expect(result.ok, `${width}×${height}`).toBe(true);
      expect(textTopology(result.stencil.coverage, width!, height!).counters).toBeGreaterThanOrEqual(3);
      expect(result.stencil.cellAligned).toBe(true);
      expect(result.stencil.quad).toBeUndefined();
    }
  });

  it('does not carve specular highlights out of a heart', () => {
    const model = emojiTextDrawing(pixels(HEART, 6));
    expect(model.details.length).toBe(0);
    const result = fitEmojiDrawing(model, { width: 12, height: 12 })!;
    expect(result.ok).toBe(true);
    expect(textTopology(result.stencil.coverage, 12, 12)).toEqual({ pieces: 1, counters: 0 });
  });

  it('does not rewrite decoded picture pixels', () => {
    const source = pixels(FACE, 6), before = source.data.slice();
    emojiTextDrawing(source);
    expect(source.data).toEqual(before);
  });

  it('retains the cleft between a heart’s lobes in even and odd widths', () => {
    const model = emojiTextDrawing(pixels(HEART, 6));
    for (const width of [5, 6, 7, 8]) {
      const result = fitEmojiDrawing(model, { width, height: 8 })!;
      expect(result.ok).toBe(true);
      const y = Math.floor(result.stencil.coverage.findIndex(value => value > 0) / width);
      const top = Array.from(result.stencil.coverage.subarray(y * width, (y + 1) * width), value => value ? '#' : '.').join('');
      expect(top).toMatch(/#+\.+#+/u);
    }
  });

  it('rejects fractional and undersized regions', () => {
    const model = emojiTextDrawing(pixels(FACE, 6));
    for (const width of [0, 4, 5.5]) expect(fitEmojiDrawing(model, { width, height: 8 })).toBeNull();
  });
});
