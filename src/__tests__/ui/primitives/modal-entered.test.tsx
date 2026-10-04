import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { useModalEntered } from '../../../ui/primitives/ModalShell';

const motionOn = ({ children }: { children: ReactNode }) => <MotionConfig reducedMotion="never">{children}</MotionConfig>;
const motionOff = ({ children }: { children: ReactNode }) => <MotionConfig reducedMotion="always">{children}</MotionConfig>;

describe('useModalEntered', () => {
  it('holds a section\'s preview until its card has entered, and again after a switch until the resize completes', () => {
    const { result, rerender } = renderHook(({ open, section }) => useModalEntered(open, section), {
      wrapper: motionOn, initialProps: { open: true, section: 'keep' },
    });
    expect(result.current.entered).toBe(false);
    act(() => result.current.onEntered());
    expect(result.current.entered).toBe(true);

    rerender({ open: true, section: 'friend' });
    expect(result.current.entered).toBe(false);
    act(() => result.current.onEntered());
    expect(result.current.entered).toBe(true);
  });

  it('keeps a settled section entered from the first frame of a return, for the rest of the session', () => {
    const { result, rerender } = renderHook(({ open, section }) => useModalEntered(open, section), {
      wrapper: motionOn, initialProps: { open: true, section: 'keep' },
    });
    act(() => result.current.onEntered());
    rerender({ open: true, section: 'friend' });
    act(() => result.current.onEntered());
    rerender({ open: true, section: 'keep' });
    expect(result.current.entered).toBe(true);
    rerender({ open: true, section: 'game' });
    expect(result.current.entered).toBe(false);
    rerender({ open: true, section: 'friend' });
    expect(result.current.entered).toBe(true);
  });

  it('falls back to not entered when the window closes and reopens', () => {
    const { result, rerender } = renderHook(({ open }) => useModalEntered(open, 'friend'), {
      wrapper: motionOn, initialProps: { open: true },
    });
    act(() => result.current.onEntered());
    rerender({ open: false });
    expect(result.current.entered).toBe(false);
    rerender({ open: true });
    expect(result.current.entered).toBe(false);
  });

  it('counts the card as entered at once under reduced motion, through a section switch too', () => {
    const { result, rerender } = renderHook(({ open, section }) => useModalEntered(open, section), {
      wrapper: motionOff, initialProps: { open: true, section: 'keep' },
    });
    expect(result.current.entered).toBe(true);
    rerender({ open: true, section: 'friend' });
    expect(result.current.entered).toBe(true);
  });
});
