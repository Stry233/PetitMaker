// @vitest-environment jsdom
/**
 * A mode switch as one choreographed score: the mode plate is remade for the chosen block, the bottom
 * bar is handed over, and every beat is registered and played. How it looks is checked in a browser.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { MODE_PLATE_ID } from '../../../ui/shell/frame';
import { SCORES, beatOf } from '../../../ui/design/motion/choreography';
import { MOTIONS } from '../../../ui/design/motion/registry';
import { useBeat } from '../../../ui/design/motion/use-motion';
import { setStoreState } from '../../_support/store';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

function mount() {
  return render(
    <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>,
    { wrapper },
  );
}

const plates = () => document.querySelectorAll(`[data-testid="${MODE_PLATE_ID}"]`);

beforeEach(() => {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setSelectingRegion(false);
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
});
afterEach(cleanup);

describe('the mode transition', () => {
  /** The plate marks "this is the one", so it is remade rather than slid along the row. */
  it('makes a new plate for the block chosen and destroys the old one', async () => {
    mount();
    expect(plates(), 'nothing is selected, so the row has no plate').toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Mountains' }));
    const first = plates()[0];
    expect(first).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    // The old plate is still leaving as the new one arrives, so the count is awaited.
    await waitFor(() => expect(plates()).toHaveLength(1));
    expect(plates()[0], 'a carried plate would be the same node').not.toBe(first);
  });

  /** The assistant is not a mode, so its plate is its own and not part of the row's switch. */
  it('leaves the assistant out of the plate the row shares', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mountains' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(plates(), 'the assistant marks itself with a plate of its own').toHaveLength(1);
  });

  /** The leaving bar overlaps the arriving one during the handover; the terrain modes share one bar
   *  that morphs its controls instead. */
  it('hands the bottom bar from the mode being left to the one arriving', async () => {
    mount();
    const bars = () => document.querySelector('[data-testid="shell-mode-bar"]')!.children;
    fireEvent.click(screen.getByRole('button', { name: 'Mountains' }));
    expect(bars()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    expect(bars(), 'the terrain surfaces share one toolbar').toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Objects' }));
    expect(bars(), 'the bar being left is still on screen for the handover').toHaveLength(2);
    await waitFor(() => expect(bars(), 'and then it is gone').toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Objects' }));
    await waitFor(() => expect(bars(), 'rest shows no bar').toHaveLength(0));
  });
});

describe('the mode switch is one score', () => {
  it('names a registered motion for every beat, and anchors on the plate', () => {
    const beats = SCORES['mode.switch'].beats;
    expect(beats.length).toBeGreaterThan(1);
    for (const beat of beats) {
      expect(MOTIONS[beat.motion], `${beat.target} names an unregistered motion`).toBeDefined();
      expect(beat.at, `${beat.target} starts before the anchor`).toBeGreaterThanOrEqual(0);
    }
    // The plate pair is the anchor: leave and arrive both at zero, everything else timed against them.
    expect(beats.find((b) => b.motion === 'mode.plate.arrive')?.at).toBe(0);
    expect(beats.find((b) => b.motion === 'mode.plate.leave')?.at).toBe(0);
  });

  it('declares a score for every choreography it names', () => {
    for (const [id, score] of Object.entries(SCORES)) expect(score.beats.length, id).toBeGreaterThan(0);
  });

  /** Every beat's target is named at the site that moves it. */
  it('is played in full by the shell', () => {
    const shell = ['Shell.tsx', 'controls/ModeRow.tsx', 'controls/ModeBar.tsx'].map((f) => readFileSync(`src/ui/shell/${f}`, 'utf8')).join('\n');
    for (const beat of SCORES['mode.switch'].beats) {
      expect(shell, `nothing plays the ${beat.target} beat`).toContain(`'${beat.target}'`);
    }
  });
});

/** Hands the motion preference to Framer as App does with `motionPref`. */
const motionAs = (reducedMotion: 'always' | 'never') => (
  ({ children }: { children: React.ReactNode }) => (
    <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
  )
);

describe('a beat waits its turn', () => {
  it('holds the arriving bar behind the one it replaces, by the score', () => {
    const { result } = renderHook(() => useBeat('mode.switch', 'bar.arriving'), { wrapper: motionAs('never') });
    expect(result.current.delay).toBe(beatOf('mode.switch', 'bar.arriving').at / 1000);
  });

  /** An instant arrival that still waited its turn would leave a hole meanwhile. */
  it('drops the wait under reduced motion', () => {
    const { result } = renderHook(() => useBeat('mode.switch', 'bar.arriving'), { wrapper: motionAs('always') });
    expect(result.current.delay, 'a withheld motion must not also be a late one').toBeUndefined();
    expect(result.current.duration, 'and it arrives with no travel').toBe(0);
  });
});


describe('assistant region selection owns the bottom controls', () => {
  it.each(['mountain', 'water', 'object', 'generate', 'annotate'] as const)('covers and restores the %s panel without changing editing mode', async (mode) => {
    useEditorStore.getState().setEditMode({ mode });
    useEditorStore.getState().setAssistantOpen(true);
    mount();
    const bar = screen.getByTestId('shell-mode-bar');
    const previous = bar.firstElementChild;
    act(() => useEditorStore.getState().setSelectingRegion(true, 'agent'));
    expect(bar.hasAttribute('inert')).toBe(true);
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    await waitFor(() => expect(screen.getAllByTestId('shell-scope-screen')).toHaveLength(1));
    expect(useEditorStore.getState().editMode.mode).toBe(mode);
    act(() => useEditorStore.getState().setSelectingRegion(false));
    await waitFor(() => expect(screen.queryByTestId('shell-scope-screen')).toBeNull());
    await waitFor(() => expect(bar.hasAttribute('inert')).toBe(false));
    expect(bar.firstElementChild).toBe(previous);
    expect(useEditorStore.getState().regionSelectionOwner).toBeNull();
  });

  it('retains an object search query when returning from region selection', async () => {
    useEditorStore.getState().setEditMode({ mode: 'object' });
    useEditorStore.getState().setAssistantOpen(true);
    mount();
    const field = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'tree' } });
    act(() => useEditorStore.getState().setSelectingRegion(true, 'agent'));
    expect(screen.queryByRole('searchbox')).toBeNull();
    act(() => useEditorStore.getState().setSelectingRegion(false));
    await waitFor(() => expect(screen.getByRole('searchbox')).toBe(field));
    expect(field.value).toBe('tree');
  });
});
