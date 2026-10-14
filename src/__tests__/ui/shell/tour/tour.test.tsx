// @vitest-environment jsdom
/**
 * The tour against the interface it describes. The overlay looks each step's target up in the live
 * DOM and passes over an absent one silently, so every step of this shell's list must find its own;
 * the walk reads the counter off the card, where a skipped step is a number that never appears.
 * `getBoundingClientRect` is stubbed to a non-zero box, but `measureTarget` looks the element up
 * first, so an absent one stays absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { TOUR_SEEN_KEY, startTour } from '../../../../ui/chrome/tour/use-tour';
import { Shell } from '../../../../ui/shell/Shell';
import { SHELL_TOUR_STEPS } from '../../../../ui/shell/tour/tour-steps';
import { setStoreState } from '../../../_support/store';

// The 3D block is offered only where three can build its scene, and jsdom has no WebGL2: the run
// under test is the one a device that can draw the map in 3D is shown.
vi.mock('../../../../platform/device/device-quality', async (orig) => ({
  ...(await orig<object>()),
  hasWebGL2: () => true,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

/** The live card. A step change replaces it and the outgoing one is on screen for its exit, so both
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
    useEditorStore.getState().setViewMode('2d');
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
    useEditorStore.getState().setViewMode('2d');
  });

  /** Walk to the step with this id from wherever the card is, reading the counter off the card so a
   *  step passed over for want of a target cannot be mistaken for the one after it. */
  async function gotoStep(id: string): Promise<void> {
    const at = SHELL_TOUR_STEPS.findIndex((s) => s.id === id) + 1; // the card counts from one
    await waitFor(() => expect(shownStep()).toBeGreaterThan(0));
    while (shownStep() < at) {
      const from = shownStep();
      clickNext();
      await waitFor(() => expect(shownStep()).toBeGreaterThan(from));
    }
    expect(shownStep()).toBe(at);
  }

  const viewMode = () => useEditorStore.getState().viewMode;

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

  /**
   * The three 3D steps. The flip is a host action, so the thing to prove is that it happens on the
   * step that points at the toggle (which is what lets the scene build behind a bubble anchored to a
   * rail button), that the block ends back in 2D, and that no way out of a run leaves a visitor in a
   * view they did not choose — `viewMode` persists, so that would follow them to the next visit.
   */
  describe('the 3D steps', () => {
    it('stands the map up on the step that points at the toggle', async () => {
      startTour();
      mount();
      await gotoStep('bar');
      expect(viewMode()).toBe('2d');
      clickNext();
      // The host action runs as the step is announced, a frame before its target has been measured
      // and the card turns over, so the view is standing by the time the bubble names it.
      await waitFor(() => expect(viewMode()).toBe('3d'));
      await waitFor(() => expect(within(card()).getByText('The map in 3D')).toBeTruthy());
    });

    it('keeps the 3D view for both steps that describe it, and lays the map flat after them', async () => {
      startTour();
      mount();
      await gotoStep('orbit');
      expect(viewMode()).toBe('3d');
      clickNext();
      await waitFor(() => expect(shownStep()).toBe(SHELL_TOUR_STEPS.findIndex((s) => s.id === 'build3d') + 1));
      expect(viewMode()).toBe('3d');
      clickNext();
      await waitFor(() => expect(viewMode()).toBe('2d'));
    });

    it('gives the view back when a visitor skips out of the middle of the 3D block', async () => {
      startTour();
      mount();
      await gotoStep('orbit');
      expect(viewMode()).toBe('3d');
      fireEvent.click(within(card()).getByRole('button', { name: 'Skip tour' }));
      await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
      expect(viewMode()).toBe('2d');
    });

    it('gives the view back on Escape too, which is the other way out', async () => {
      startTour();
      mount();
      await gotoStep('orbit');
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
      expect(viewMode()).toBe('2d');
    });

    it('leaves a visitor who was ALREADY in 3D there, however the run ends', async () => {
      // The toggle step's host action is then a no-op and its copy still reads true (the button is
      // the switch either way); what must not happen is the run quietly moving them to 2D.
      useEditorStore.getState().setViewMode('3d');
      startTour();
      mount();
      await gotoStep('view3d');
      expect(viewMode()).toBe('3d');
      await gotoStep('assistant');
      expect(viewMode()).toBe('2d'); // the block ends flat for everyone
      fireEvent.click(within(card()).getByRole('button', { name: 'Skip tour' }));
      await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
      expect(viewMode()).toBe('3d');
    });
  });
});
