// @vitest-environment jsdom
/**
 * The host half of the tour's reveal invariant: `Shell.handleTourStep` must set the mode
 * synchronously inside the overlay's layout-phase callback, because the step's target does not
 * exist until that set lands. Other tour tests stub the lookup; this one uses real `useState` and
 * the real DOM, stubbing only `getBoundingClientRect` (`measureTarget` reads a zero rect as absent).
 *
 * jsdom's rAF is a ~16ms timer and `act()` flushes a transition like a synchronous set, so a
 * deferred set fails only in a browser; this catches a set that has not landed when the overlay
 * measures at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { TourOverlay } from '../../../../ui/chrome/tour/TourOverlay';
import { TOUR_SEEN_KEY, startTour } from '../../../../ui/chrome/tour/use-tour';
import { tourTargetAttr, type TourStep } from '../../../../ui/chrome/tour/steps';
import { SHELL_TOUR_STEPS } from '../../../../ui/shell/tour/tour-steps';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { setStoreState } from '../../../_support/store';

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

/** The live card, and its Next. A step change replaces the card, and the outgoing one is on screen
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
    // One press, and the run has walked past every step this host never draws a target for: the
    // tools step and the 3D toggle are both passed over rather than lighting the origin, and it
    // comes to rest on the next step that names no target at all.
    await waitFor(() => expect(screen.getByText('Looking around in 3D')).toBeTruthy());
    expect(screen.queryByText('Your tools are down here')).toBeNull();
    expect(screen.queryByText('The map in 3D')).toBeNull();
    // From that step on, the ones that name a target are passed over the same way, so the two
    // targetless steps are the whole of what is left and the second press ends the run.
    clickNext();
    await waitFor(() => expect(screen.getByText('Build right here in 3D')).toBeTruthy());
    clickNext();
    await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
  });
});
