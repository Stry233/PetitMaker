/**
 * The load meter measures its own text and stores the result, so it has to settle.
 *
 * It re-measures when the text or the SCALE changes. Depending on `pxf` instead — the helper
 * `usePx` returns — looks equivalent and is not: that is a fresh closure on every render, so the
 * effect fires every render, sets state, and renders again. React stops it after fifty rounds with
 * "Maximum update depth exceeded", which takes the whole component down rather than leaving a text
 * nudge off by a pixel.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LoadBar } from '../../ui/menu/LoadBar';
import { ScaleProvider } from '../../ui/menu/scale';

let errors: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = [];
  // React reports a runaway update through console.error rather than by throwing where the test
  // can see it, so that is what has to be watched.
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(String(args[0])); });
});
afterEach(() => { spy.mockRestore(); cleanup(); });

const runaway = () => errors.filter((e) => /Maximum update depth/.test(e));

describe('the load meter', () => {
  it('settles on mount', () => {
    render(<ScaleProvider value={1}><LoadBar value={0} max={10000} /></ScaleProvider>);
    expect(runaway()).toEqual([]);
  });

  it('and settles again when the UI is scaled', () => {
    const { rerender } = render(<ScaleProvider value={1}><LoadBar value={0} max={10000} /></ScaleProvider>);
    for (const s of [1.4, 2.4, 0.4]) {
      rerender(<ScaleProvider value={s}><LoadBar value={0} max={10000} /></ScaleProvider>);
    }
    expect(runaway()).toEqual([]);
  });

  it('and when only the reading changes', () => {
    const { rerender } = render(<ScaleProvider value={1}><LoadBar value={0} max={10000} /></ScaleProvider>);
    rerender(<ScaleProvider value={1}><LoadBar value={120} max={10000} /></ScaleProvider>);
    expect(runaway()).toEqual([]);
  });
});
