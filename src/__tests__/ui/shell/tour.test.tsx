/**
 * The tour, run against the interface it describes.
 *
 * A step names a target and the overlay looks that target up in the live DOM, so the thing worth
 * proving is that every step of THIS shell's list finds its own: a target that is absent is passed
 * over silently, and a tour that silently skips half of itself is the same failure as a Settings row
 * that does nothing. The run is walked step by step and the counter is read off the card, because a
 * skipped step shows up there as a number that never appears.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` is stubbed to a non-zero box for every element.
 * That does not weaken the assertion: `measureTarget` looks the element up first, and an absent one
 * is still absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { TOUR_SEEN_KEY, startTour } from '../../../ui/chrome/tour/use-tour';
import { Shell } from '../../../ui/shell/Shell';
import { SHELL_TOUR_STEPS } from '../../../ui/shell/tour-steps';
import { setStoreState } from '../../_store';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

/** The LIVE card. A step change replaces it and the outgoing one is on screen for its exit, so both
 *  a read and a click have to name the last of them. */
function card(): HTMLElement {
  const all = screen.getAllByRole('dialog');
  return all[all.length - 1]!;
}

function shownStep(): number {
  return Number(/Step (\d+) of/.exec(card().textContent ?? '')?.[1] ?? 0);
}

function clickNext(): void {
  const live = card();
  const next = within(live).queryByRole('button', { name: 'Next' })
    ?? within(live).getByRole('button', { name: 'Start building' });
  fireEvent.click(next);
}

function mount() {
  return render(
    <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>,
    { wrapper },
  );
}

describe('the tour over the game shell', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en' });
    localStorage.setItem(TOUR_SEEN_KEY, '1'); // a replay from Settings, not the first-launch offer
    useEditorStore.getState().setTourRunning(false);
    useEditorStore.getState().setEditMode({ mode: null });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, width: 200, height: 120,
      left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useEditorStore.getState().setTourRunning(false);
    useEditorStore.getState().setModal('tourDone', false);
  });

  it('runs every step, and each one finds the surface it points at', async () => {
    startTour();
    mount();

    for (let i = 0; i < SHELL_TOUR_STEPS.length; i++) {
      const step = SHELL_TOUR_STEPS[i]!;
      await waitFor(() => expect(shownStep()).toBe(i + 1));
      if (step.target) {
        expect(document.querySelector(`[data-tour-target="${step.target}"]`)).not.toBeNull();
      }
      // A key with no translation renders as the key itself, which reads as copy nobody wrote.
      expect(card().textContent).not.toContain('tour.');
      clickNext();
    }

    await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
    expect(useEditorStore.getState().modals.tourDone).toBe(true);
  });

  it('ends with the interface at rest', async () => {
    startTour();
    mount();
    // The step about the tools selects a mode to have a bar to point at.
    for (let i = 0; i < 4; i++) { await waitFor(() => expect(shownStep()).toBe(i + 1)); clickNext(); }
    expect(useEditorStore.getState().editMode.mode).toBe('mountain');

    for (let i = 4; i < SHELL_TOUR_STEPS.length; i++) { await waitFor(() => expect(shownStep()).toBe(i + 1)); clickNext(); }
    expect(useEditorStore.getState().editMode.mode).toBeNull();
  });

  it('leaves the control it lights up clickable', async () => {
    startTour();
    mount();
    for (let i = 0; i < SHELL_TOUR_STEPS.length - 1; i++) {
      await waitFor(() => expect(shownStep()).toBe(i + 1));
      clickNext();
    }
    await waitFor(() => expect(shownStep()).toBe(SHELL_TOUR_STEPS.length));

    // The last step points at the menu button. The dim takes no pointer events, so pressing it
    // while the tour is still on opens the sheet exactly as it would with no tour running.
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('never selects the generate mode, whose bar starts building the moment it appears', () => {
    expect(SHELL_TOUR_STEPS.some((s) => s.mode === 'generate')).toBe(false);
  });
});
