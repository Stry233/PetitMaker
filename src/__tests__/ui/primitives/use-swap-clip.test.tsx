// @vitest-environment jsdom
/**
 * A keyed arrival's box clips only while the arrival travels: from each new key until its motion
 * reports done, a quick return to the previous key included, never at rest (where a hovered card's
 * growth and a focus ring must show), and never under reduced motion, where nothing travels. Where
 * the engine can, only the inline axis the arrival travels along clips.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { useSwapClip } from '../../../ui/primitives/use-swap-clip';

const motion = (reducedMotion: 'always' | 'never') => ({ children }: { children: ReactNode }) =>
  <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>;

const clips = (clip: object) => Object.keys(clip).length > 0;

describe('useSwapClip', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clips from a new key until its arrival settles, and not at rest', () => {
    const view = renderHook(({ id }) => useSwapClip(id), { initialProps: { id: 'trees' }, wrapper: motion('never') });
    expect(clips(view.result.current.clip)).toBe(true);
    act(() => view.result.current.settle());
    expect(view.result.current.clip).toEqual({});
    view.rerender({ id: 'flowers' });
    expect(clips(view.result.current.clip)).toBe(true);
    act(() => view.result.current.settle());
    expect(view.result.current.clip).toEqual({});
  });

  it('clips a return to the previous key made before the key between settles', () => {
    const view = renderHook(({ id }) => useSwapClip(id), { initialProps: { id: 'trees' }, wrapper: motion('never') });
    act(() => view.result.current.settle());
    view.rerender({ id: 'flowers' });
    const flowersSettle = view.result.current.settle;
    view.rerender({ id: 'trees' });
    expect(clips(view.result.current.clip)).toBe(true);
    // The arrival that was cut short reports nothing about the one that replaced it.
    act(() => flowersSettle());
    expect(clips(view.result.current.clip)).toBe(true);
    act(() => view.result.current.settle());
    expect(view.result.current.clip).toEqual({});
  });

  it('takes the first key as standing when asked to start from rest', () => {
    const view = renderHook(({ id }) => useSwapClip(id, { fromRest: true }), { initialProps: { id: 'shut' }, wrapper: motion('never') });
    expect(view.result.current.clip).toEqual({});
    view.rerender({ id: 'open' });
    expect(clips(view.result.current.clip)).toBe(true);
  });

  it('clips only the inline axis where the engine supports it', () => {
    vi.stubGlobal('CSS', { supports: (property: string, value: string) => property === 'overflow-x' && value === 'clip' });
    const view = renderHook(() => useSwapClip('trees'), { wrapper: motion('never') });
    expect(view.result.current.clip).toEqual({ overflowX: 'clip' });
  });

  it('clips the block axis alone, or both axes, when asked', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const block = renderHook(() => useSwapClip('trees', { axes: 'block' }), { wrapper: motion('never') });
    expect(block.result.current.clip).toEqual({ overflowY: 'clip' });
    const both = renderHook(() => useSwapClip('trees', { axes: 'both' }), { wrapper: motion('never') });
    expect(both.result.current.clip).toEqual({ overflow: 'hidden' });
  });

  it('never clips under reduced motion', () => {
    const view = renderHook(({ id }) => useSwapClip(id), { initialProps: { id: 'trees' }, wrapper: motion('always') });
    expect(view.result.current.clip).toEqual({});
    view.rerender({ id: 'flowers' });
    expect(view.result.current.clip).toEqual({});
  });
});
