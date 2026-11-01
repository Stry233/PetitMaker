// @vitest-environment jsdom
/**
 * The game shell's mode row, the assistant block beside it, the panel floor per bar, the restore offer
 * in the empty shelf band, and putting the interface away, read through roles, labels and store state.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ToolType } from '../../../state/editing/vocabulary';
import { declineRestoreOffer } from '../../../ui/session/restore-offer';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { footReserve } from '../../../ui/shell/panel-frame';
import { MODES } from '../../../ui/shell/frame';
import { RestoreShelf } from '../../../ui/shell/bars/generate/RestoreShelf';
import { Shell } from '../../../ui/shell/Shell';
import { activeToolOf } from '../../../state/editing/edit-mode';

vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

/** The autosave offered at mount; the tests need only that one exists, so it is not a real save. */
const offered = vi.hoisted(() => ({ save: null as unknown }));
vi.mock('../../../io/storage/autosave', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../io/storage/autosave')>(),
  readRestorableAutosave: () => offered.save,
}));

const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

function mountShell() {
  return render(
    <I18nProvider>
      <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
    </I18nProvider>,
  );
}

/** The assistant's own block in the mode row. */
function assistantBlock(): HTMLElement {
  return screen.getByLabelText(translate('mode.assistant'));
}

/**
 * Mounts the lazy assistant panel once up front: under test its `import()` transforms the whole
 * assistant graph, which can outlast an async query's 1s default, and React's `lazy` payload resolves
 * only on a first mount. Later assertions then measure the shell alone, independent of test order.
 */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, TOUR_OFFERED);
  useEditorStore.setState({ locale: 'en', assistantOpen: true });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
});

beforeEach(() => {
  backing.clear();
  offered.save = null;
  backing.set(TOUR_SEEN_KEY, TOUR_OFFERED); // skips the first-launch tour
  useEditorStore.setState({ locale: 'en', assistantOpen: false });
  useEditorStore.getState().setEditMode({ mode: null });
});
afterEach(cleanup);

describe('the assistant is a block on its own row', () => {
  it('shares the modes\' left edge and is not one of their line', () => {
    mountShell();
    const row = document.querySelector('[data-tour-target="modes"]')!;
    expect(row.querySelectorAll('button').length, 'the row holds the modes and nothing else').toBe(MODES.length);
    expect(row.contains(assistantBlock())).toBe(false);
  });

  it('opens nothing until it is pressed, and closes again on the next press', async () => {
    mountShell();
    expect(screen.queryByTestId('shell-assistant-panel')).toBeNull();

    fireEvent.click(assistantBlock());
    expect(await screen.findByTestId('shell-assistant-panel')).toBeTruthy();

    fireEvent.click(assistantBlock());
    // The plate leaves through an exit animation.
    await waitFor(() => expect(screen.queryByTestId('shell-assistant-panel')).toBeNull());
  });

  it('sits beside the selected mode rather than taking its place', async () => {
    mountShell();
    act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain' }); });
    fireEvent.click(assistantBlock());
    await screen.findByTestId('shell-assistant-panel');
    // The assistant arms nothing, so opening it must not disarm the brush.
    expect(useEditorStore.getState().editMode.mode).toBe('mountain');
  });

  it('says so to a screen reader either way', () => {
    mountShell();
    expect(assistantBlock().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(assistantBlock());
    expect(assistantBlock().getAttribute('aria-expanded')).toBe('true');
  });
});

describe("[UI-40] the free panel's floor follows the bar that is showing", () => {
  it('reserves nothing at rest and the same room for both shelves', () => {
    expect(footReserve(null)).toBe(0);
    expect(footReserve('object')).toBe(footReserve('generate'));
  });

  it('reserves each bar its own depth: terrain rows, the road strip over them, the notes rows deepest', () => {
    expect(footReserve('water')).toBe(footReserve('mountain'));
    expect(footReserve(null)).toBeLessThan(footReserve('mountain'));
    expect(footReserve('mountain')).toBeLessThan(footReserve('road'));
    expect(footReserve('road')).toBeLessThan(footReserve('annotate'));
  });
});

describe('a mode block', () => {
  /** A block is a toggle, not a radio: pressing the mode in force returns the editor to rest. */
  it('puts its own mode away when it is the one in force', () => {
    mountShell();
    const mountain = screen.getByLabelText(translate('mode.mountain'));
    fireEvent.click(mountain);
    expect(useEditorStore.getState().editMode.mode).toBe('mountain');
    expect(mountain.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(mountain);
    expect(useEditorStore.getState().editMode.mode).toBeNull();
    expect(mountain.getAttribute('aria-pressed')).toBe('false');
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);

    // A different block switches directly.
    fireEvent.click(mountain);
    fireEvent.click(screen.getByLabelText(translate('mode.water')));
    expect(useEditorStore.getState().editMode.mode).toBe('water');
  });
});

describe('the restore offer', () => {
  const noop = () => {};
  const shelf = (onRestore = noop, onDismiss = noop) => render(
    <I18nProvider>
      <RestoreShelf state={{} as never} onRestore={onRestore} onDismiss={onDismiss} />
    </I18nProvider>,
  );
  /** The seconds the offer tells a screen reader it waits before pressing itself. */
  const announcedWait = (): number => {
    const button = document.querySelector('[aria-describedby]')!;
    return Number(/\d+/.exec(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent!)![0]);
  };

  /** The saved map's card is itself the resume control, with the words beside it and both answers
   *  as pills under them. */
  it('is a card that presses itself, with the words beside it and both answers as pills', () => {
    shelf();
    const card = screen.getByTestId('restore-card');
    expect(card.tagName).toBe('BUTTON');
    // `aria-label` replaces the card's text, so it carries the title as well as the action.
    expect(card.getAttribute('aria-label')).toContain(translate('restore.title'));
    expect(card.getAttribute('aria-label')).toContain(translate('restore.resume'));
    expect(screen.getByText(translate('restore.title'))).toBeTruthy();
    expect(screen.getByText(translate('restore.body'))).toBeTruthy();
    const fresh = screen.getByTestId('restore-fresh');
    expect(fresh.tagName).toBe('BUTTON');
    expect(card.contains(fresh), 'no button nested in a button').toBe(false);
    const resume = screen.getByTestId('restore-resume');
    expect(card.contains(resume), 'no button nested in a button').toBe(false);
  });

  it('names what it is and one way to decline, and nothing behind it is locked out', () => {
    shelf();
    expect(screen.getByText(translate('restore.title'))).toBeTruthy();
    expect(screen.getByText(translate('restore.fresh'))).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls back the choice the visitor made, and nothing else', () => {
    const restore = vi.fn();
    const dismiss = vi.fn();
    shelf(restore, dismiss);
    fireEvent.click(screen.getByText(translate('restore.fresh')));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('restore-card'));
    expect(restore).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('restore-resume'));
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('presses itself when nothing answers it, and resumes rather than starting fresh', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const restore = vi.fn();
      const dismiss = vi.fn();
      shelf(restore, dismiss);
      expect(restore).not.toHaveBeenCalled();
      // Ignoring the offer resumes: starting fresh is recoverable from, discarding the save is not.
      await act(async () => { await vi.advanceTimersByTimeAsync((announcedWait() + 1) * 1000); });
      expect(restore).toHaveBeenCalled();
      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /** The frame is drawn behind the boot splash, so the countdown must not run until the splash
   *  clears. */
  it('does not spend its clock while the boot splash still covers it', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const restore = vi.fn();
      const draw = (splashActive: boolean) => (
        <I18nProvider>
          <RestoreShelf state={{} as never} splashActive={splashActive} onRestore={restore} onDismiss={noop} />
        </I18nProvider>
      );
      const view = render(draw(true));
      await act(async () => { await vi.advanceTimersByTimeAsync((announcedWait() + 1) * 1000); });
      expect(restore, 'nobody has seen the offer yet').not.toHaveBeenCalled();

      view.rerender(draw(false));
      // The full wait remains after the splash.
      await act(async () => { await vi.advanceTimersByTimeAsync((announcedWait() - 1) * 1000); });
      expect(restore).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(restore).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the clock while keyboard focus rests on a pill, the same as a hovering pointer', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const restore = vi.fn();
      const dismiss = vi.fn();
      shelf(restore, dismiss);
      fireEvent.focus(screen.getByTestId('restore-fresh'));
      await act(async () => { await vi.advanceTimersByTimeAsync((announcedWait() + 1) * 1000); });
      expect(restore).not.toHaveBeenCalled();
      expect(dismiss).not.toHaveBeenCalled();

      fireEvent.blur(screen.getByTestId('restore-fresh'));
      await act(async () => { await vi.advanceTimersByTimeAsync((announcedWait() + 1) * 1000); });
      expect(restore).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('where the restore offer stands', () => {
  beforeEach(() => { offered.save = { state: {} }; });

  const card = () => screen.queryByTestId('restore-card');

  it('steps aside for the What\'s new window and comes back, where any other window dismisses it', async () => {
    mountShell();
    await screen.findByTestId('restore-card');
    act(() => { useEditorStore.getState().setModal('whatsNew', true); });
    await waitFor(() => expect(card()).toBeNull());
    act(() => { useEditorStore.getState().setModal('whatsNew', false); });
    await screen.findByTestId('restore-card');
    act(() => { useEditorStore.getState().setModal('settings', true); });
    act(() => { useEditorStore.getState().setModal('settings', false); });
    await waitFor(() => expect(card()).toBeNull());
  });

  it('is withdrawn once the visitor chooses a mode', async () => {
    mountShell();
    await screen.findByTestId('restore-card');
    fireEvent.click(screen.getByLabelText(translate('mode.mountain')));
    // Choosing a mode is choosing to build on this map, and its bar takes the band.
    await waitFor(() => expect(card()).toBeNull());
  });

  /** A surface outside the shell (the arrival notice's OK) answers the card through the same
   *  dismissal path as its own "start fresh". */
  it('offers its own dismissal to whatever stands beside it', async () => {
    mountShell();
    await screen.findByTestId('restore-card');
    act(() => { declineRestoreOffer(); });
    await waitFor(() => expect(card()).toBeNull());
    // Once the offer is gone, a later call falls on nothing.
    expect(() => declineRestoreOffer()).not.toThrow();
  });

  /** Opening the assistant answers the offer through `useRestoreOffer`'s `dismiss`, discarding the saved session,
   *  so the card does not return when the panel closes. */
  it('is dismissed for good once the assistant panel opens, and stays gone once it closes', async () => {
    mountShell();
    await screen.findByTestId('restore-card');

    act(() => { useEditorStore.setState({ assistantOpen: true }); });
    await waitFor(() => expect(card()).toBeNull());

    act(() => { useEditorStore.setState({ assistantOpen: false }); });
    await waitFor(() => expect(useEditorStore.getState().assistantOpen).toBe(false));
    expect(card()).toBeNull();

    expect(() => declineRestoreOffer()).not.toThrow();
  });

  it('never stands at all when the assistant panel is already open at mount, and stays gone once it closes', async () => {
    act(() => { useEditorStore.setState({ assistantOpen: true }); });
    mountShell();
    await waitFor(() => expect(card()).toBeNull());

    act(() => { useEditorStore.setState({ assistantOpen: false }); });
    await waitFor(() => expect(useEditorStore.getState().assistantOpen).toBe(false));
    expect(card()).toBeNull();
  });
});

/** Hiding the interface takes the frame away but leaves the button that hid it, so the way back is
 *  where the way out was. Modals stand outside the frame. */
describe('the interface can be put away', () => {
  const hideButton = () => screen.getByLabelText(translate('a11y.hide_ui'));

  it('takes every frame control out of reach and leaves the button that brings it back', () => {
    mountShell();
    act(() => { useEditorStore.getState().setEditMode({ mode: 'object' }); });
    const mountain = () => screen.queryByRole('button', { name: translate('mode.mountain') });
    expect(mountain()).not.toBeNull();

    fireEvent.click(hideButton());
    expect(mountain(), 'the mode row is hidden from pointer and screen reader alike').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: translate('a11y.show_ui') }));
    expect(mountain()).not.toBeNull();
  });
});
