import { describe, expect, it } from 'vitest';
import { emojiLineModel } from '../../../../tools/generation/stencil/stencil-line-emoji';
import { fitStrokeText } from '../../../../tools/generation/stencil/stencil-line-text';

describe('emoji print outlines', () => {
  it('retains a closed perimeter and detached facial features', () => {
    const width = 32, height = 32;
    const silhouette = new Uint8Array(width * height);
    for (let y = 3; y < 29; y++) for (let x = 3; x < 29; x++) silhouette[y * width + x] = 255;
    const details = [[10 * width + 10], [10 * width + 21], Array.from({ length: 12 }, (_, x) => 21 * width + 10 + x)];
    const coverage = silhouette.slice();
    for (const feature of details) for (const i of feature) coverage[i] = 0;
    const model = emojiLineModel({ width, height, coverage, silhouette, details, pieces: 1, edgeRuns: [1, 1, 1, 1] })!;
    expect(model).not.toBeNull();
    expect(model.pieces).toBe(4);
    expect(model.counters).toBe(1);
    const stencil = fitStrokeText([{ model, ascent: height, descent: 0, unitsPerPixel: 1, contour: true }], { width, height })!;
    expect(stencil).not.toBeNull();
    expect(stencil.coverage[16 * width + 16]).toBe(0);
    expect([...stencil.coverage].filter(Boolean).length).toBeLessThan(150);
  });
});
