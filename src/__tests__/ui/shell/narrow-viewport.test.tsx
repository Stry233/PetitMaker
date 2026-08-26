/**
 * What the game shell does when the window runs out of room, and what it offers a visitor who
 * reloads.
 *
 * The assertions here are on the DECISIONS, not on the pixels: jsdom lays nothing out, so a rect
 * assertion would only restate the constants. What is worth pinning is that the assistant is one
 * block of a row of six and opens nothing until it is pressed, that pressing it leaves the selected
 * mode alone, that the choice survives a reload, that the panel's floor follows the bar that is
 * showing rather than one number for all five modes, that a caption under the leftmost control
 * stops sliding at the frame's margin, that the viewport's vignette is not inside the frame's own
 * zoom, and that the restore offer exists, is opt-in, and is only made for a save with real
 * content.
 *
 * Where that offer STANDS is pinned here too, because it is placed by an argument rather than by a
 * measurement: the bottom-left corner is bare map only while nothing else claims it, and the two
 * things that can are a bottom bar and the assistant's panel. The card is placed by two constants
 * (jsdom lays nothing out), so what the assertions are really about is which corner it names and
 * what happens to it when each of those two arrives.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ToolType } from '../../../core/model/types';
import { PREF_STORAGE_KEYS } from '../../../core/runtime/prefs';
import { declineRestoreOffer } from '../../../core/runtime/restore-offer';
import { I18nProvider, translate } from '../../../i18n/context';
import { createShellSlice } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { VIGNETTE_DEPTH } from '../../../ui/design/tokens';
import { footReserve } from '../../../ui/shell/panel-frame';
import { MODES } from '../../../ui/shell/frame';
import { RestoreShelf, RESTORE_AFTER_S } from '../../../ui/shell/bars/RestoreShelf';
import { Shell } from '../../../ui/shell/Shell';
import { captionShift, EDGE_LEFT } from '../../../ui/shell/units';

/** The autosave the shell is offered at mount. A real one would mean serializing a map through the
 *  codec, which is a different subject entirely: what these tests need is that there IS one. */
const offered = vi.hoisted(() => ({ save: null as unknown }));
vi.mock('../../../io/autosave', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../io/autosave')>(),
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
  return screen.getByLabelText(translate('generate.algo_agent'));
}

/**
 * OPEN THE PANEL ONCE BEFORE ANY OF IT IS TIMED.
 *
 * The panel is the app's one lazy chunk, and two costs ride on the first mount of its life, neither
 * of them the product's. `import()` here is a live transform of the whole assistant graph rather
 * than a fetch of a built one (measured 0.6-1.0s with the shell warm, 3.1-3.6s cold, against the 1s
 * an async query allows by default); and React's `lazy` payload suspends on its FIRST render however
 * warm the module is, so a mount is what moves it to resolved, not an import. Paying both here
 * leaves every assertion below measuring the shell's own work: the async ones stop racing a
 * compiler, and the one that reads the panel SYNCHRONOUSLY (a returning visitor's, further down)
 * stops passing merely for having run after another test.
 */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, '1');
  useEditorStore.setState({ locale: 'en', assistantOpen: true });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
});

beforeEach(() => {
  backing.clear();
  offered.save = null; // nothing to restore, unless a test says there is
  backing.set(TOUR_SEEN_KEY, '1'); // a returning visitor: the first-launch tour is not the subject
  useEditorStore.setState({ locale: 'en', assistantOpen: false });
  useEditorStore.getState().setEditMode({ mode: null });
});
afterEach(cleanup);

describe('the assistant is a block on its own row', () => {
  it('shares the modes\' left edge and is not one of their line', () => {
    mountShell();
    const row = document.querySelector('[data-tour-target="modes"]')!;
    expect(row.childElementCount).toBe(MODES.length);
    expect(row.contains(assistantBlock())).toBe(false);
    // jsdom lays nothing out, so what is worth asserting is the number both are placed by.
    expect((assistantBlock().parentElement as HTMLElement).style.left)
      .toBe((row as HTMLElement).style.left);
  });

  it('opens nothing until it is pressed, and closes again on the next press', async () => {
    mountShell();
    expect(screen.queryByTestId('shell-assistant-panel')).toBeNull();

    fireEvent.click(assistantBlock());
    expect(await screen.findByTestId('shell-assistant-panel')).toBeTruthy();

    fireEvent.click(assistantBlock());
    // The plate leaves through an exit animation, so it is on screen for a moment after the press.
    await waitFor(() => expect(screen.queryByTestId('shell-assistant-panel')).toBeNull());
  });

  it('sits beside the selected mode rather than taking its place', async () => {
    mountShell();
    act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain' }); });
    fireEvent.click(assistantBlock());
    await screen.findByTestId('shell-assistant-panel');
    // The five arm a tool and only one can be armed; the assistant arms nothing, so opening it
    // must not disarm the brush the visitor was building with.
    expect(useEditorStore.getState().editMode.mode).toBe('mountain');
  });

  it('boots collapsed, and a press leaves nothing behind that could open it next time', () => {
    // The key an earlier build kept the choice under, written by hand: a device that still holds
    // it must still boot to the map.
    backing.set(LEGACY_OPEN_KEY, '1');
    expect(freshShellSlice().assistantOpen).toBe(false);

    mountShell();
    expect(screen.queryByTestId('shell-assistant-panel')).toBeNull();
    fireEvent.click(assistantBlock());
    expect(useEditorStore.getState().assistantOpen).toBe(true);
    expect(PREF_STORAGE_KEYS).not.toContain(LEGACY_OPEN_KEY);
    expect(backing.get(LEGACY_OPEN_KEY)).toBe('1'); // untouched: nothing writes it
  });

  it('says so to a screen reader either way', () => {
    mountShell();
    expect(assistantBlock().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(assistantBlock());
    expect(assistantBlock().getAttribute('aria-expanded')).toBe('true');
  });
});

describe("the panel's floor follows the bar that is showing", () => {
  it('keeps least room clear with no bar and most under the generate shelf', () => {
    expect(footReserve(null)).toBeLessThan(footReserve('mountain'));
    expect(footReserve('mountain')).toBeLessThan(footReserve('object'));
    expect(footReserve('object')).toBeLessThan(footReserve('generate'));
  });

  it('answers the three terrain modes alike, since they draw the same bar', () => {
    expect(footReserve('road')).toBe(footReserve('mountain'));
    expect(footReserve('water')).toBe(footReserve('mountain'));
  });
});

describe('a mode block', () => {
  /** The game names its own modes straight on the map, with an outline in place of a plate. */
  it('names itself on the map, with no plate under the word', () => {
    mountShell();
    fireEvent.click(screen.getByLabelText(translate('mode.mountain')));
    const caption = screen.getAllByText(translate('mode.mountain'))
      .find((el) => el.tagName === 'SPAN')!;
    expect(caption.style.background).toBe('');
    expect(caption.style.color).toBe('rgb(255, 254, 227)');
    expect(caption.getAttribute('style')).toContain('-webkit-text-stroke');
  });

  /**
   * A block is a toggle, not a radio: pressing the mode in force puts it away and the editor is
   * back at REST — no bar, no armed tool. Rest is a state the visitor can reach on purpose, not
   * only the one they start in.
   */
  it('puts its own mode away when it is the one in force', () => {
    mountShell();
    const mountain = screen.getByLabelText(translate('mode.mountain'));
    fireEvent.click(mountain);
    expect(useEditorStore.getState().editMode.mode).toBe('mountain');
    expect(mountain.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(mountain);
    expect(useEditorStore.getState().editMode.mode).toBeNull();
    expect(mountain.getAttribute('aria-pressed')).toBe('false');
    // Rest means rest: nothing is armed, so the map takes no marks.
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);

    // A different block still switches, rather than needing the old one turned off first.
    fireEvent.click(mountain);
    fireEvent.click(screen.getByLabelText(translate('mode.water')));
    expect(useEditorStore.getState().editMode.mode).toBe('water');
  });
});

describe('the viewport vignette', () => {
  /** An edge is shaded because something stands there. With no mode chosen nothing does at the
   *  bottom, so that edge's shading is carried below the fold rather than darkening bare map — and
   *  it TRAVELS there, on the bottom bar's own beat, rather than the bottom of the screen changing
   *  colour on its own. */
  it('carries its shading below the fold while the bottom of the screen is empty', async () => {
    mountShell();
    const pane = () => screen.getByTestId('shell-vignette');
    /** How far down the pane is standing. It keeps the viewport's height and moves by transform, so
     *  the offset is in the transform and the inset is 0 in every state. */
    const drop = () => Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(pane().style.transform)?.[1] ?? '0');
    expect(useEditorStore.getState().editMode.mode).toBeNull();
    expect(pane().style.bottom).toBe('0px');
    expect(drop()).toBeCloseTo(VIGNETTE_DEPTH, 3);

    act(() => { useEditorStore.getState().setEditMode({ mode: 'object' }); });
    await waitFor(() => expect(drop()).toBeLessThan(1));
  });

  it('stands outside the frame\'s zoom, so its inset is the window\'s own', () => {
    mountShell();
    const pane = screen.getByTestId('shell-vignette');
    // `inset: 0` inside the zoomed subtree would resolve against the zoomed box, leaving the
    // vignette short of the window's real edges by the zoom factor. The frame's wrapper is the one
    // element that names a zoom, and it names it twice (the property and `--shell-zoom`), which is
    // what a jsdom style attribute can still be searched for.
    for (let el = pane.parentElement; el; el = el.parentElement) {
      expect(el.getAttribute('style') ?? '').not.toContain('zoom');
    }
  });
});

describe('a caption under the leftmost control', () => {
  it('centres where there is room and stops at the frame margin where there is not', () => {
    // A control whose centre is far from the edge: a caption of any width stays centred.
    expect(captionShift(400)).toContain('-50%');
    // The first control of a row: half a long caption would reach past the window, so the shift is
    // floored at the margin the rest of the frame keeps.
    expect(captionShift(EDGE_LEFT + 19)).toBe(`translateX(max(-50%, ${-19}px))`);
  });
});

describe('the restore offer', () => {
  const noop = () => {};
  const shelf = (onRestore = noop, onDismiss = noop) => render(
    <I18nProvider>
      <RestoreShelf state={{} as never} onRestore={onRestore} onDismiss={onDismiss} />
    </I18nProvider>,
  );

  /**
   * THE SAVED MAP IS THE CARD, and the card is the control: a candidate card at 1.8x standing up
   * out of the shelf plate, with the words in a column beside it and the two answers as pills
   * under the words. A click on the picture resumes, exactly as a click on a candidate builds.
   */
  it('is a card that presses itself, with the words beside it and both answers as pills', () => {
    shelf();
    const card = screen.getByTestId('restore-card');
    expect(card.tagName).toBe('BUTTON');
    // The composed label carries the whole offer, not just the action: a screen reader must hear
    // the title and body that `aria-label` would otherwise silence.
    expect(card.getAttribute('aria-label')).toContain(translate('restore.title'));
    expect(card.getAttribute('aria-label')).toContain(translate('restore.resume'));
    expect(screen.getByText(translate('restore.title'))).toBeTruthy();
    expect(screen.getByText(translate('restore.body'))).toBeTruthy();
    // The pills are SIBLINGS of the card, not children: a button may not nest in a button.
    const fresh = screen.getByTestId('restore-fresh');
    expect(fresh.tagName).toBe('BUTTON');
    expect(card.contains(fresh), 'no button nested in a button').toBe(false);
    const resume = screen.getByTestId('restore-resume');
    expect(card.contains(resume), 'no button nested in a button').toBe(false);
  });

  /** The clock is the row-of-names mark, spent rather than filled: the fuse along a plate edge was
   *  a drawing this interface has nowhere else. */
  it('counts down on the shelf\'s own yellow mark, not on an outline ring', () => {
    // jsdom lays nothing out, so the clock (gated on a measured box) needs a width to draw at all.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
    try {
      shelf();
      const card = screen.getByTestId('restore-card');
      expect(card.querySelector('svg line'), 'the mark is a line').toBeTruthy();
      expect(card.querySelector('svg rect'), 'the ring is not also drawn').toBeNull();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
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
    expect(restore).toHaveBeenCalledTimes(2); // the card press above plus the pill
  });

  it('presses itself when nothing answers it, and resumes rather than starting fresh', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const restore = vi.fn();
      const dismiss = vi.fn();
      shelf(restore, dismiss);
      expect(restore).not.toHaveBeenCalled();
      // IGNORING THE OFFER MEANS RESUME: the default falls toward the recoverable option, since New
      // brings back a clean map while declining destroys what was saved.
      await act(async () => { await vi.advanceTimersByTimeAsync((RESTORE_AFTER_S + 1) * 1000); });
      expect(restore).toHaveBeenCalled();
      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A COUNTDOWN MAY ONLY RUN OVER TIME THE CARD WAS ON SCREEN FOR.
   *
   * The frame is drawn behind the boot splash, so the offer is standing (and counting) while a
   * visitor is still watching the island being built. Whatever was left of the twelve seconds when
   * the splash cleared is what they got, which on a cold boot was most of the offer spent.
   */
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
      await act(async () => { await vi.advanceTimersByTimeAsync((RESTORE_AFTER_S + 1) * 1000); });
      expect(restore, 'nobody has seen the offer yet').not.toHaveBeenCalled();

      view.rerender(draw(false));
      // And the WHOLE of it is still there to spend, rather than the remainder of a clock that ran
      // behind the splash: a second short of the full wait is a second short.
      await act(async () => { await vi.advanceTimersByTimeAsync((RESTORE_AFTER_S - 1) * 1000); });
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
      // A visitor tabbing through lands on Start fresh and hesitates: the offer must wait for
      // them, not resume itself out from under a control they are still reading.
      fireEvent.focus(screen.getByTestId('restore-fresh'));
      await act(async () => { await vi.advanceTimersByTimeAsync((RESTORE_AFTER_S + 1) * 1000); });
      expect(restore).not.toHaveBeenCalled();
      expect(dismiss).not.toHaveBeenCalled();

      // Moving focus off the pill releases the hold, same as a pointer leaving it.
      fireEvent.blur(screen.getByTestId('restore-fresh'));
      await act(async () => { await vi.advanceTimersByTimeAsync((RESTORE_AFTER_S + 1) * 1000); });
      expect(restore).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('where the restore offer stands', () => {
  beforeEach(() => { offered.save = { state: {} }; });

  const card = () => screen.queryByTestId('restore-card');

  it('stands in the shelf band a fresh session leaves empty', async () => {
    mountShell();
    const el = await screen.findByTestId('restore-card');
    // The band runs the width of the window and sits on its floor, which is where both bottom bars
    // stand: the offer is in the room a visitor who has chosen no mode is not using, rather than
    // floating in a corner.
    const band = el.closest('div[style*="position: fixed"]') as HTMLElement;
    expect(band.style.bottom).toBe('0px');
    expect(band.style.left).toBe('0px');
    expect(band.style.right).toBe('0px');
  });

  it('is withdrawn once the visitor chooses a mode', async () => {
    mountShell();
    await screen.findByTestId('restore-card');
    fireEvent.click(screen.getByLabelText(translate('mode.mountain')));
    // Choosing a mode is choosing to build on this map, and it is also what puts a bar in the
    // corner the card stands in. The card leaves through an exit animation.
    await waitFor(() => expect(card()).toBeNull());
  });

  /** The one dismissal, offered to a surface standing outside this shell: the arrival notice's OK
   *  is a hand saying where it is, which answers this card too. It goes through the SAME path the
   *  card's own "start fresh" takes rather than a second one, which is what this pins. */
  it('offers its own dismissal to whatever stands beside it', async () => {
    mountShell();
    await screen.findByTestId('restore-card');
    act(() => { declineRestoreOffer(); });
    await waitFor(() => expect(card()).toBeNull());
    // And nothing is registered once the offer has gone, so a later press falls on nothing.
    expect(() => declineRestoreOffer()).not.toThrow();
  });

  /** ENGAGING THE ASSISTANT IS AN ANSWER, not merely a panel drawn over the corner. It goes through
   *  `dismissRestore` itself (discarding the saved session, same as opening the menu or choosing a
   *  mode), so the card must not come back once the panel is put away. */
  it('is dismissed for good once the assistant panel opens, and stays gone once it closes', async () => {
    mountShell();
    await screen.findByTestId('restore-card');

    act(() => { useEditorStore.setState({ assistantOpen: true }); });
    await waitFor(() => expect(card()).toBeNull());

    // Putting the panel away again must not resurrect the offer: opening it was the decision.
    act(() => { useEditorStore.setState({ assistantOpen: false }); });
    await waitFor(() => expect(useEditorStore.getState().assistantOpen).toBe(false));
    expect(card()).toBeNull();

    // And the channel other surfaces answer it through falls on nothing, same as any other
    // dismissal already taken.
    expect(() => declineRestoreOffer()).not.toThrow();
  });

  /** A page that mounts the shell with the panel already engaged counts the same as a fresh press:
   *  the offer never stands, and closing the panel does not raise it. */
  it('never stands at all when the assistant panel is already open at mount, and stays gone once it closes', async () => {
    act(() => { useEditorStore.setState({ assistantOpen: true }); });
    mountShell();
    await waitFor(() => expect(card()).toBeNull());

    act(() => { useEditorStore.setState({ assistantOpen: false }); });
    await waitFor(() => expect(useEditorStore.getState().assistantOpen).toBe(false));
    expect(card()).toBeNull();
  });
});

/** A fresh `createShellSlice`, as a boot builds it: the state a new page starts from, read without
 *  standing up a store. The two setters it is handed do nothing — nothing here calls one. */
function freshShellSlice() {
  return createShellSlice(() => {}, () => ({}) as never, null as never);
}

/** The key an earlier build persisted the open state under. Nothing reads or writes it. */
const LEGACY_OPEN_KEY = 'petit-planet-assistant-open';

/**
 * PUTTING THE INTERFACE AWAY. What is worth pinning is the line: the frame goes, and the one button
 * that put it away does not, so there is a way back where the way out was. Everything modal stands
 * outside this frame and is untouched by construction, which is the reason that line was drawn
 * there.
 */
describe('the interface can be put away', () => {
  const hideButton = () => screen.getByLabelText(translate('a11y.hide_ui'));

  it('draws the whole frame away and leaves the button that did it', () => {
    mountShell();
    act(() => { useEditorStore.getState().setEditMode({ mode: 'object' }); });
    const wrapper = () => screen.getByTestId('shell-frame-veil');
    expect(wrapper().style.visibility).toBe('visible');

    fireEvent.click(hideButton());
    // Both, on one clock: the fade is what is seen and the visibility is what takes the frame out of
    // reach, and CSS holds the second until the first has finished.
    expect(wrapper().style.opacity).toBe('0');
    expect(wrapper().style.visibility).toBe('hidden');
    expect(wrapper().style.transition).toContain('visibility');
    // The shading goes with the shelf it was under: there is no seam left to soften.
    const drop = () => Number.parseFloat(
      /translateY\((-?[\d.]+)px\)/.exec(screen.getByTestId('shell-vignette').style.transform)?.[1] ?? '0',
    );
    expect(drop()).toBeCloseTo(VIGNETTE_DEPTH, 3);

    const back = screen.getByLabelText(translate('a11y.show_ui'));
    expect(back.style.visibility).toBe('visible');
    fireEvent.click(back);
    expect(wrapper().style.visibility).toBe('visible');
  });
});
