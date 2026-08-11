/**
 * The motion preference has to reach THREE gates that can't read the store themselves: the canvas rAF
 * loops (the `motion-state` singleton), CSS (`<html data-reduced-motion>`), and Framer (<MotionConfig>
 * in App, covered by its own props). These tests pin the two that `useMotionEnabled` publishes,
 * including the cases a CSS media query cannot express on its own: "Reduced" while the OS says
 * no-preference, and "Full" while the OS asks for reduce.
 *
 * The last block pins the one piece of chrome that reads the Framer gate itself: the config's
 * `reducedMotion` collapses transforms but still animates opacity, so a card whose CONTENT swaps
 * under a standing user has to branch its own transitions or the outgoing rows ride out the exit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { renderHook, render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useMotionEnabled } from '../../ui/hooks/useMotionEnabled';
import { useEditorStore } from '../../state/store';
import { isMotionReduced, __resetMotionState } from '../../canvas/map2d/motion-state';
import { I18nProvider } from '../../i18n/context';
import { HintPanel } from '../../ui/hints/HintPanel';
import { ToolType } from '../../core/model/types';

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
  const css = readFileSync('src/ui/design/animations.css', 'utf8');

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
    expect(readFileSync('src/ui/primitives/Spinner.tsx', 'utf8')).toContain('pw-busy');
  });
});

describe('the hint panel branches its own swap on the Framer gate', () => {
  function mountHints(reduced: boolean) {
    return render(
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        <I18nProvider><HintPanel /></I18nProvider>
      </MotionConfig>,
    );
  }
  /** The AnimatePresence child holding the current rows: what the enter/exit transitions drive. */
  const rows = () => screen.getByLabelText('Quick hints').firstElementChild as HTMLElement;
  const toEraser = () => act(() => useEditorStore.setState({ activeTool: ToolType.Eraser, designMode: 'eraser' }));
  const settle = () => act(async () => { await Promise.resolve(); });

  beforeEach(() => {
    useEditorStore.setState({
      hintLevel: 'full', activeTool: ToolType.Hand, designMode: 'hand',
      selection: [], selectedItemId: null, selectingRegion: false,
      tourRunning: false, portraitBlocked: false,
    });
  });
  afterEach(cleanup);

  it('lands a scenario change at its end state, with nothing left mid-exit', async () => {
    mountHints(true);
    expect(screen.getByText('Select several objects')).toBeTruthy();
    toEraser();
    await settle();
    expect(screen.getByText('Lower terrain, layer by layer')).toBeTruthy();
    expect(screen.queryByText('Select several objects')).toBeNull();
    expect(rows().style.opacity).toBe('1');
    expect(rows().style.transform).toBe('none');
  });

  it('still animates the swap when motion is full', async () => {
    mountHints(false);
    toEraser();
    await settle();
    // mode="wait": the old rows hold the card until their exit finishes, which is the tell.
    expect(screen.getByText('Select several objects')).toBeTruthy();
  });

  // A LEVEL change is the second animation on this card: the rows past the concise cut fade out
  // while the card's measured height springs down under them. Same gate, same tell.
  const collapse = () => act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show fewer hints' })); });

  it('drops the collapsed rows outright when motion is reduced', async () => {
    mountHints(true);
    expect(screen.getByText('Select several objects')).toBeTruthy();
    collapse();
    await settle();
    expect(screen.queryByText('Select several objects')).toBeNull();
  });

  it('holds them for their fade when motion is full', async () => {
    mountHints(false);
    collapse();
    await settle();
    expect(screen.getByText('Select several objects')).toBeTruthy();
  });

  // The third animation on this card is the card ITSELF: it fades and scales toward the zoom
  // cluster on the way in and out. The gate is read off the ENTER's rendered start state, which is
  // just style and therefore exact. Whether the card has LEFT is deliberately not asserted here:
  // removal is driven by framer's own frame loop, which jsdom does not schedule reproducibly, so
  // the timing is a flake rather than a gate. That the card outlives the click at all is pinned
  // synchronously in the hint-panel suite instead.
  const shell = () => screen.getByRole('note').parentElement as HTMLElement;

  it('starts the panel flat when motion is reduced', () => {
    mountHints(true);
    expect(shell().style.transform).not.toContain('scale');
  });

  it('starts it scaled toward the zoom cluster when motion is full', () => {
    mountHints(false);
    expect(shell().style.transform).toContain('scale');
    expect(shell().style.transformOrigin).toBe('100% 100%');
  });
});
