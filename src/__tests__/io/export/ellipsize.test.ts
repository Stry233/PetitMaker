import { describe, it, expect } from 'vitest';
import { ellipsize } from '../../../io/export/canvas-helpers';

// Fake 2D context: each character is 10px wide (deterministic, no canvas needed).
const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as unknown as CanvasRenderingContext2D;

describe('ellipsize', () => {
  it('returns the text unchanged when it fits', () => {
    expect(ellipsize(ctx, 'short', 100)).toBe('short');
  });
  it('truncates with an ellipsis and stays within maxW', () => {
    const out = ellipsize(ctx, 'a very very long island title that cannot fit', 120);
    expect(out.endsWith('…')).toBe(true);
    expect(ctx.measureText(out).width).toBeLessThanOrEqual(120);
  });
  it('force always appends an ellipsis even if it fits', () => {
    expect(ellipsize(ctx, 'short', 1000, true).endsWith('…')).toBe(true);
  });
  it('never returns an empty string for a non-empty input', () => {
    expect(ellipsize(ctx, 'hello', 1).length).toBeGreaterThan(0);
  });
});
