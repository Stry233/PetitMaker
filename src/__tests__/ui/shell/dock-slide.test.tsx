/**
 * THE SLIDE'S FRAMES ARE WRITTEN PAST REACT.
 *
 * The dock's travel is one animated fraction and every distance in the move is a multiple of it —
 * but a fraction that reached its surfaces as a React render made every frame of the slide re-render
 * the whole tree, and the sheet froze and leapt wherever a frame ran over budget while the panel's
 * compositor-carried beats played on beside it. So the moving styles are written imperatively on the
 * motion value's own change, and React is notified only when the fraction crosses an end.
 *
 * What jsdom can pin about that: the fraction moving notifies no React subscriber (and crossing an
 * end does); a render that does happen mid-flight reads the live fraction; and the two tracks the
 * map plane rides — the transform and the clip — carry the SAME travel in the same `inset()` shape
 * at every fraction, because a clip that changed shape form mid-flight is one Chrome would refuse to
 * carry between keyframes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { Shell } from '../../../ui/shell/Shell';
import {
  DOCK_PARALLAX, PINNED_COLUMN_W, PINNED_DOCK_REF_W, frameZoomAt,
} from '../../../ui/shell/panel-frame';
import { ZOOM } from '../../../ui/shell/units';
import { seconds } from '../../../ui/agent/motion';
import { dockAside, useDockDriver, useDockStage } from '../../../ui/shell/use-dock';

const backing = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  },
});

function widen(w: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

const FullMotion = ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="never">{children}</MotionConfig>
);

function mountShell() {
  return render(
    <MotionConfig reducedMotion="never">
      <I18nProvider>
        <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
      </I18nProvider>
    </MotionConfig>,
  );
}

/** The frame's plane: the element carrying the frame's zoom. */
function plane(): HTMLElement {
  return screen.getByTestId('shell-frame-veil').parentElement as HTMLElement;
}

/** Into the slide: dock asked for, the floating exit played out, the sheet told to move. */
function enterSlide(): void {
  act(() => { useEditorStore.setState({ assistantPinned: true, assistantOpen: true }); });
  act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
}

beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, '1');
  useEditorStore.setState({ locale: 'en', assistantOpen: true, assistantPinned: false });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
}, 40_000);

beforeEach(() => {
  useEditorStore.setState({
    locale: 'en', assistantOpen: true, assistantPinned: false, assistantDockSide: 'left',
  });
  widen(1600);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  backing.clear();
  backing.set(TOUR_SEEN_KEY, '1');
});

describe('the fraction moves without rendering', () => {
  const stage = () => renderHook(() => {
    useDockDriver();
    const renders = useRef(0);
    renders.current += 1;
    return { stage: useDockStage(), renders };
  }, { wrapper: FullMotion });

  it('notifies React only when the fraction crosses an end', () => {
    vi.useFakeTimers();
    const { result } = stage();
    enterSlide();
    // Into flight: the first change is a crossing (flat -> between), and it renders.
    act(() => { dockAside.set(0.01); });
    const settled = result.current.renders.current;
    // Every frame after it is silent.
    act(() => { dockAside.set(0.4); });
    act(() => { dockAside.set(0.7); });
    expect(result.current.renders.current).toBe(settled);
    // Landing is a crossing again, and the stage reads the landed fraction.
    act(() => { dockAside.set(1); });
    expect(result.current.renders.current).toBeGreaterThan(settled);
    expect(result.current.stage.aside).toBe(1);
  });

  it('hands a mid-flight render the live fraction rather than a stale one', () => {
    vi.useFakeTimers();
    const { result, rerender } = stage();
    enterSlide();
    act(() => { dockAside.set(0.35); });
    rerender();
    expect(result.current.stage.aside).toBeCloseTo(0.35, 10);
  });
});

describe('the sheet is written on the fraction\'s own change', () => {
  const mapPlane = () => screen.getByTestId('shell-map-plane');

  /** What the writer owes the DOM at a fraction, from the same arithmetic the shell renders with. */
  const at = (v: number) => {
    const zoom = frameZoomAt(v, window.innerWidth, window.innerHeight, 1);
    const travel = (v * PINNED_DOCK_REF_W * (zoom / ZOOM)) / 2;
    return { zoom, travel };
  };

  it('moves both of the map plane\'s tracks the same distance, in one clip shape', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    vi.useFakeTimers();
    enterSlide();
    for (const v of [0.2, 0.55, 0.9]) {
      act(() => { dockAside.set(v); });
      const { travel } = at(v);
      const tf = mapPlane().style.transform;
      const clip = mapPlane().style.clipPath;
      expect(parseFloat(tf.replace('translateX(', ''))).toBeCloseTo(travel, 6);
      // The clip stays the SAME shape function with the SAME component count at every fraction,
      // carrying the transform's own travel on both edges.
      const m = clip.match(/^inset\(0(?:px)? ([\d.]+)px 0(?:px)? ([\d.]+)px\)$/);
      expect(m, clip).not.toBeNull();
      expect(parseFloat(m?.[1] ?? '')).toBeCloseTo(travel, 6);
      expect(parseFloat(m?.[2] ?? '')).toBeCloseTo(travel, 6);
      // The plane's box does not move mid-flight: the travel is the transform's, never the inset's.
      expect(mapPlane().style.left).toBe('0px');
      expect(mapPlane().style.pointerEvents).toBe('none');
    }
  });

  it('carries the frame\'s inset and its fit on the same frame', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    vi.useFakeTimers();
    enterSlide();
    act(() => { dockAside.set(0.5); });
    const { zoom } = at(0.5);
    expect(parseFloat(plane().style.left)).toBeCloseTo(0.5 * PINNED_COLUMN_W, 6);
    expect(parseFloat(plane().style.zoom)).toBeCloseTo(zoom, 6);
    expect(parseFloat(plane().style.getPropertyValue('--shell-zoom'))).toBeCloseTo(zoom, 6);
    // The edge published for the surfaces outside the frame glides on the same write.
    expect(parseFloat(document.documentElement.style.getPropertyValue('--pin-dock-left')))
      .toBeCloseTo(0.5 * PINNED_DOCK_REF_W, 6);
  });

  it('lands the settled styles itself, so the last frame needs no render to be right', async () => {
    mountShell();
    await screen.findByTestId('shell-assistant-panel');
    vi.useFakeTimers();
    enterSlide();
    act(() => { dockAside.set(0.5); });
    act(() => { dockAside.set(1); });
    const { travel } = at(1);
    expect(mapPlane().style.transform).toBe('');
    expect(mapPlane().style.clipPath).toBe('');
    expect(mapPlane().style.pointerEvents).not.toBe('none');
    expect(parseFloat(mapPlane().style.left)).toBeCloseTo(travel * 2, 6);
    expect(parseFloat(plane().style.left)).toBeCloseTo(PINNED_COLUMN_W, 6);
  });

  it('drifts the ground under the sheet on the same change, and leaves nothing behind', async () => {
    mountShell();
    const wrapper = await screen.findByTestId('shell-assistant-panel');
    vi.useFakeTimers();
    enterSlide();
    act(() => { dockAside.set(0.4); });
    expect(parseFloat(wrapper.style.transform.replace('translateX(', '')))
      .toBeCloseTo((1 - 0.4) * DOCK_PARALLAX * -1, 6);
    act(() => { dockAside.set(1); });
    expect(wrapper.style.transform).toBe('');
  });
});
