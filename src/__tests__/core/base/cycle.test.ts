/** A cycle steps either way round its options and wraps at both ends; from a value it lacks it enters at the end it steps from. */
import { describe, expect, it } from 'vitest';
import { stepIn } from '../../../core/base/cycle';

const SHAPES = ['free', 'rect', 'circle', 'line'] as const;

describe('stepIn', () => {
  it('steps forward and back, wrapping at both ends', () => {
    expect(stepIn(SHAPES, 'rect', 1)).toBe('circle');
    expect(stepIn(SHAPES, 'line', 1)).toBe('free');
    expect(stepIn(SHAPES, 'rect', -1)).toBe('free');
    expect(stepIn(SHAPES, 'free', -1)).toBe('line');
  });

  it('enters a list that lacks the current value at its first option forward and its last back', () => {
    const offered: readonly string[] = ['rect', 'circle', 'line'];
    expect(stepIn(offered, 'free', 1)).toBe('rect');
    expect(stepIn(offered, 'free', -1)).toBe('line');
  });

  it('keeps the current value in an empty group', () => {
    expect(stepIn([], 'free', 1)).toBe('free');
  });
});
