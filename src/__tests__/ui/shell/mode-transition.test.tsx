/**
 * The plate is ONE element that moves, not five that appear.
 *
 * The shell is a single frame with swappable contents, so a mode switch should read as the shell
 * reconfiguring itself rather than as one panel replaced by another. A shared `layoutId` is what
 * makes Framer animate the same node between two parents; five conditionally-rendered images cannot
 * travel however they are tweened.
 *
 * jsdom lays nothing out, so what a DOM test can hold is the STRUCTURE the travel needs: one plate
 * in the row at a time, carrying the id both blocks name it by. That the travel then reads as a
 * slide is a visual claim, checked in a browser.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { MODE_PLATE_ID } from '../../../ui/shell/frame';
import { SCORES, beatOf, beatsOf } from '../../../ui/shell/motion/choreography';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import { useBeat } from '../../../ui/shell/motion/use-motion';
import { setStoreState } from '../../_store';

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
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
});
afterEach(cleanup);

describe('the mode transition', () => {
  /**
   * The plate is MADE and DESTROYED, not carried.
   *
   * A plate that travelled would read as one splat sliding along the row, a claim about the row
   * rather than about the block. What the mark means is "this is the one", and the block that was it
   * no longer is, so the old plate is destroyed and a new one made. The element identity is the
   * assertion: a carried plate is the same node at a new place.
   */
  it('makes a new plate for the block chosen and destroys the old one', async () => {
    mount();
    expect(plates(), 'nothing is selected, so the row has no plate').toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Mountains' }));
    const first = plates()[0];
    expect(first).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    // The old one is still leaving while the new one arrives, which is the crossing both plate
    // beats describe, so what settles is waited for rather than read.
    await waitFor(() => expect(plates()).toHaveLength(1));
    expect(plates()[0], 'a carried plate would be the same node').not.toBe(first);
  });

  /** The assistant is a block of the same family but it is not a mode, so its own plate is not part
   *  of the row's switch: it neither arrives with one nor leaves with one. */
  it('leaves the assistant out of the plate the row shares', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mountains' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(plates(), 'the assistant marks itself with a plate of its own').toHaveLength(1);
  });

  /**
   * The bar belongs to the mode, so a switch takes one off and puts the next on.
   *
   * The one leaving is STILL THERE the moment the next arrives: that overlap is the handover the two
   * bar beats describe, and it is why the count has to be waited for rather than read.
   */
  it('hands the bottom bar from the mode being left to the one arriving', async () => {
    mount();
    const bars = () => document.querySelectorAll('[data-tour-target="bar"]');
    fireEvent.click(screen.getByRole('button', { name: 'Mountains' }));
    expect(bars()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    expect(bars(), 'the bar being left is still on screen for the handover').toHaveLength(2);
    await waitFor(() => expect(bars(), 'and then it is gone').toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Water' }));
    await waitFor(() => expect(bars(), 'rest shows no bar').toHaveLength(0));
  });
});

describe('the mode switch is one score', () => {
  it('names a registered motion for every beat, and anchors on the plate', () => {
    const beats = beatsOf('mode.switch');
    expect(beats.length).toBeGreaterThan(1);
    for (const beat of beats) {
      expect(MOTIONS[beat.motion], `${beat.target} names an unregistered motion`).toBeDefined();
      expect(beat.at, `${beat.target} starts before the anchor`).toBeGreaterThanOrEqual(0);
    }
    // The plate is still the anchor, now as a pair: the old ground goes as the new arrives, both
    // at zero, and everything else in the switch is timed against them.
    expect(beats.find((b) => b.motion === 'mode.plate.arrive')?.at).toBe(0);
    expect(beats.find((b) => b.motion === 'mode.plate.leave')?.at).toBe(0);
  });

  it('declares a score for every choreography it names', () => {
    for (const id of Object.keys(SCORES)) expect(beatsOf(id as keyof typeof SCORES).length).toBeGreaterThan(0);
  });

  /** A beat is only worth declaring if something plays it: an unplayed one is the half-rolled-out
   *  rollout this system exists to stop. Every target is named at the site that moves it. */
  it('is played in full by the shell', () => {
    const shell = readFileSync('src/ui/shell/Shell.tsx', 'utf8');
    for (const beat of beatsOf('mode.switch')) {
      expect(shell, `nothing plays the ${beat.target} beat`).toContain(`'${beat.target}'`);
    }
  });
});

/** `reducedMotion` is how the preference reaches Framer, which is what App does with `motionPref`. */
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

  /** The wait goes with the travel. An element that still waited its turn before arriving instantly
   *  would leave a hole where it is simply missing, which is not what reduced motion asks for. */
  it('drops the wait under reduced motion', () => {
    const { result } = renderHook(() => useBeat('mode.switch', 'bar.arriving'), { wrapper: motionAs('always') });
    expect(result.current.delay, 'a withheld motion must not also be a late one').toBeUndefined();
    expect(result.current.duration, 'and it arrives with no travel').toBe(0);
  });
});
