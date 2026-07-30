/**
 * The motion preference has to reach THREE gates that can't read the store themselves: the canvas rAF
 * loops (the `motion-state` singleton), CSS (`<html data-reduced-motion>`), and Framer (<MotionConfig>
 * in App, covered by its own props). These tests pin the two that `useMotionEnabled` publishes,
 * including the cases a CSS media query cannot express on its own: "Reduced" while the OS says
 * no-preference, and "Full" while the OS asks for reduce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { renderHook } from '@testing-library/react';
import { useMotionEnabled } from '../../ui/useMotionEnabled';
import { useEditorStore } from '../../state/store';
import { isMotionReduced, __resetMotionState } from '../../canvas/map2d/motion-state';

/** Pretend the OS asks (or doesn't ask) for reduced motion. */
function mockOsPrefers(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
const attr = (): string | undefined => document.documentElement.dataset.reducedMotion;

beforeEach(() => {
  __resetMotionState();
  delete document.documentElement.dataset.reducedMotion;
});
afterEach(() => vi.unstubAllGlobals());

describe('useMotionEnabled publishes the effective preference', () => {
  it('"reduced" reduces both gates even when the OS asks for nothing', () => {
    mockOsPrefers(false);
    useEditorStore.setState({ motionPref: 'reduced' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
  });

  it('"full" keeps motion on even when the OS asks for reduce', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'full' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(false);
    // Must be an explicit '0', not just absent: the CSS media query is scoped to opt out on it.
    expect(attr()).toBe('0');
  });

  it('"system" follows the OS, both ways', () => {
    mockOsPrefers(true);
    useEditorStore.setState({ motionPref: 'system' });
    const a = renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(true);
    expect(attr()).toBe('1');
    a.unmount();

    mockOsPrefers(false);
    useEditorStore.setState({ motionPref: 'system' });
    renderHook(() => useMotionEnabled());
    expect(isMotionReduced()).toBe(false);
    expect(attr()).toBe('0');
  });
});

describe('the CSS gate agrees with the attribute the hook writes', () => {
  const css = readFileSync('src/ui/animations.css', 'utf8');

  it('keys its reduced rules off data-reduced-motion, not only the media query', () => {
    expect(css).toContain("[data-reduced-motion='1']");
    // "Full" must be able to opt out of the pre-hydration media query.
    expect(css).toContain(":root:not([data-reduced-motion='0'])");
  });

  it('collapses component-owned CSS transitions, which Framer cannot see', () => {
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it('exempts the busy indicator so a spinner never freezes', () => {
    expect(css).toContain(':not(.pw-busy)');
    expect(readFileSync('src/ui/Spinner.tsx', 'utf8')).toContain('pw-busy');
  });
});
