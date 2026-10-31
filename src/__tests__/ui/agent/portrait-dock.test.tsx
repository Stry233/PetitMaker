// @vitest-environment jsdom
/**
 * The dock sequence on an upright window, at the stage the planes and the panel read: the open panel
 * docks at the foot on the same beats a side dock takes, a turn of the device while the panel is
 * closed or floating moves nothing, since no ground stands at either end, and a turn that moves a
 * docked panel lands before the paint, the layout-shape morph drawing the move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { useEditorStore } from '../../../state/store';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { seconds } from '../../../ui/design/motion';
import { useDockDriver, useDockStage } from '../../../ui/shell/use-dock';

type Stage = ReturnType<typeof useDockStage>;
const seen: Stage[] = [];

function Probe() {
  useDockDriver();
  seen.push(useDockStage());
  return null;
}

function mount(shape: LayoutShape) {
  const tree = (s: LayoutShape) => (
    <MotionConfig reducedMotion="never"><InputModeProvider inputMode="touch" shape={s}><Probe /></InputModeProvider></MotionConfig>
  );
  const view = render(tree(shape));
  return { turn: (s: LayoutShape) => view.rerender(tree(s)), now: () => seen[seen.length - 1]! };
}

beforeEach(() => {
  vi.useFakeTimers();
  seen.length = 0;
  useEditorStore.setState({ assistantOpen: false, assistantPinned: false, assistantDockSide: 'left' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the dock on an upright window', () => {
  it('docks the opened panel at the foot in one beat, without a pin', () => {
    const { now } = mount('portrait');
    expect(now()).toMatchObject({ place: 'free', edge: 'bottom' });
    act(() => { useEditorStore.setState({ assistantOpen: true }); });
    expect(now()).toMatchObject({ place: 'leaving', sheetAside: false, edge: 'bottom' });
    act(() => { vi.advanceTimersByTime(seconds('panel.close') * 1000 + 1); });
    expect(now()).toMatchObject({ place: 'ground', sheetAside: true, edge: 'bottom' });
  });

  it('a turn with the panel closed runs no beat, so no desk stands for a moment', () => {
    const { turn } = mount('portrait');
    turn('landscape');
    turn('portrait');
    expect(seen.every((stage) => stage.place === 'free')).toBe(true);
  });

  it('a turn to a wide window with no dock intent stands the panel free at once, for the layout-shape morph to carry', () => {
    act(() => { useEditorStore.setState({ assistantOpen: true }); });
    const { turn, now } = mount('portrait');
    expect(now()).toMatchObject({ place: 'ground', edge: 'bottom' });
    seen.length = 0;
    turn('landscape');
    expect(now()).toMatchObject({ place: 'free', edge: 'left', aside: 0 });
    // No beat of the old sequence is drawn on the way: the frame after the turn is already free.
    expect(seen.filter((stage) => stage.place !== 'free').length).toBeLessThanOrEqual(1);
  });
});
