/**
 * The HOST half of the tour's reveal invariant.
 *
 * `Shell.handleTourStep` carries a comment that its mode change must be a direct, synchronous
 * state set inside the overlay's layout-phase callback, because the step's target (the selected
 * mode's bottom bar) does not exist in the DOM until that set lands. Every other tour test stubs
 * `document.querySelector` and mutates a Set to stand in for the app, so none of them exercises
 * that: they prove the OVERLAY asks at the right moment, not that a real React host can answer.
 *
 * This one uses real `useState` and the real DOM lookup — only `getBoundingClientRect` is stubbed,
 * because jsdom lays nothing out and `measureTarget` reads a zero-sized rect as absent.
 *
 * What it cannot prove: jsdom's rAF is a ~16ms timer, so any deferral of the set beats the
 * measurement here and would lose the step only in a browser. Neither can `act()` tell a
 * `startTransition` apart from a synchronous set, since it flushes both. What fails here is a set
 * that has not landed by the time the overlay measures at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { TourOverlay } from '../../../ui/chrome/tour/TourOverlay';
import { TOUR_SEEN_KEY, startTour } from '../../../ui/chrome/tour/use-tour';
import { tourTargetAttr, type TourStep } from '../../../ui/chrome/tour/steps';
import { SHELL_TOUR_STEPS } from '../../../ui/shell/tour-steps';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_store';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

/**
 * The shell, reduced to the one fact the tour depends on: the bottom bar belongs to the selected
 * mode, so it is not in the DOM until a mode is on, and only `onStepEnter` turns one on.
 */
function Host({ apply }: { apply: (set: (on: boolean) => void, step: TourStep) => void }) {
  const [barUp, setBarUp] = useState(false);
  return (
    <>
      <div {...tourTargetAttr('modes')} />
      {barUp && <div {...tourTargetAttr('bar')} />}
      <TourOverlay steps={SHELL_TOUR_STEPS} onStepEnter={(step) => apply(setBarUp, step)} />
    </>
  );
}

/** Exactly what Shell.handleTourStep does. */
function applyDirect(setBarUp: (on: boolean) => void, step: TourStep) {
  if (step.mode !== undefined) setBarUp(step.mode !== null);
}

/** The LIVE card, and its Next. A step change replaces the card, and the outgoing one is on screen
 *  for the length of its exit, so both a query and a click have to name the last of them. */
function card(): HTMLElement {
  const all = screen.getAllByRole('dialog');
  return all[all.length - 1]!;
}
function clickNext() {
  fireEvent.click(within(card()).getByRole('button', { name: 'Next' }));
}

function shownStep(): number {
  return Number(/Step (\d+) of/.exec(card().textContent ?? '')?.[1] ?? 0);
}

describe('the host reveals a step\'s target from inside onStepEnter', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en' });
    localStorage.removeItem(TOUR_SEEN_KEY);
    useEditorStore.getState().setTourRunning(false);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, width: 200, height: 120,
      left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useEditorStore.getState().setTourRunning(false);
  });

  it('shows the step whose target only comes into being when the step is announced', async () => {
    startTour();
    render(<Host apply={applyDirect} />, { wrapper });
    clickNext(); // welcome -> camera
    clickNext(); // camera -> the mode row
    await waitFor(() => expect(shownStep()).toBe(3)); // the mode row, measured

    clickNext();
    // The tools step is the one whose target the host creates: without the reveal landing before
    // the measurement it is passed over, and the counter jumps straight past 4.
    await waitFor(() => expect(shownStep()).toBe(4));
    expect(screen.getByText('Your tools are down here')).toBeTruthy();
    expect(document.querySelector('[data-tour-target="bar"]')).not.toBeNull();
  });

  it('passes that step over when the host has not revealed the target by the time it is measured', async () => {
    startTour();
    // A host that never answers is the same shape as one that answers too late: the overlay looks,
    // finds nothing, and moves on rather than lighting the origin.
    render(<Host apply={() => {}} />, { wrapper });
    clickNext();
    clickNext();
    await waitFor(() => expect(shownStep()).toBe(3));

    clickNext();
    // ONE press, and the tour is over: the tools step and every step after it names a target this
    // host never draws, so each is passed over in turn. No step past 3 was ever put on the card,
    // which is what a press would otherwise have been needed to leave.
    await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
    expect(screen.queryByText('Your tools are down here')).toBeNull();
  });
});
