// @vitest-environment jsdom
/**
 * The arrival notice as seen: which planet it names, when it may say so, and the eyebrow's one swap.
 * The gate's reasoning is tested in `arrival-gate.test.ts`; this pins that the component collects
 * the right facts and retries when they change, so an arrival under the tour comes up after it.
 *
 * Fake timers run the eyebrow's three seconds. The dismissals live in
 * `arrival-toast-dismiss.test.tsx`: Framer's frame loop stops for the rest of a file once it has
 * installed fake timers, which would leave an exit animation unplayed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { ArrivalToast } from '../../../../ui/chrome/floating/ArrivalToast';
import { __resetArrivals, announceArrival } from '../../../../ui/session/arrival-bus';
import { __resetRestoreOffer, offerRestoreDismiss } from '../../../../ui/session/restore-offer';
import { TOUR_SEEN_KEY } from '../../../../ui/chrome/tour/use-tour';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { getMapTemplate, MAP_LIST } from '../../../../config/maps';
import { createGrid } from '../../../../core/model/grid-model';
import type { GridState } from '../../../../core/model/types';

/** How long each eyebrow line holds before the next takes the row, in ms. */
const EYEBROW_SWAP_MS = 3000;

/** The seconds the notice tells a screen reader it waits before pressing OK itself. */
function announcedWait(): number {
  const ok = screen.getByTestId('arrival-ok');
  return Number(/\d+/.exec(document.getElementById(ok.getAttribute('aria-describedby')!)!.textContent!)![0]);
}

const HEXIA = getMapTemplate('hexia');
/** The second planet, for the switch: the notice names whichever map is live. */
const OTHER = MAP_LIST.find((m) => m.id !== HEXIA.id)!;

function mapOn(template = HEXIA): GridState {
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

function mount(props: { splashActive?: boolean; reduced?: boolean } = {}) {
  return render(
    <MotionConfig reducedMotion={props.reduced ? 'always' : 'never'}>
      <I18nProvider>
        <ArrivalToast splashActive={props.splashActive ?? false} />
      </I18nProvider>
    </MotionConfig>,
  );
}

/** What the eyebrow is saying. The hidden strut beside it is a width and never a line, so it is
 *  not in here; under full motion an outgoing line is, for as long as its crossfade lasts. */
const eyebrow = () => screen.getAllByTestId('arrival-eyebrow').map((e) => e.textContent);

/** The deferred gate check plus whatever it scheduled. */
const settle = () => act(() => { vi.advanceTimersByTime(1); });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  __resetArrivals();
  __resetRestoreOffer();
  localStorage.setItem(TOUR_SEEN_KEY, '1');
  const st = useEditorStore.getState();
  useEditorStore.setState({
    gridState: mapOn(),
    locale: 'en',
    tourRunning: false,
    portraitBlocked: false,
    modals: { ...st.modals, tourDone: false, newProject: false },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the arrival notice', () => {
  it('names the planet the map is, under the arrival phrase', () => {
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    expect(eyebrow()).toEqual(["You're at"]);
    expect(screen.getByText(HEXIA.name.en)).toBeTruthy();
  });

  it('leaves a plain boot on its one line', () => {
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    wait(EYEBROW_SWAP_MS * 2);
    expect(eyebrow()).toEqual(["You're at"]);
  });

  it('fades a restored session from the phrase to its own line', () => {
    mount();
    act(() => announceArrival({ kind: 'restored' }));
    settle();
    expect(eyebrow()).toEqual(["You're at"]);
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toContain('Your last progress is back');
  });

  it('cuts to the detail under reduced motion, with nothing left of the phrase', () => {
    mount({ reduced: true });
    act(() => announceArrival({ kind: 'restored' }));
    settle();
    expect(eyebrow()).toEqual(["You're at"]);
    wait(EYEBROW_SWAP_MS);
    // A cut: one line, and it is the detail. Nothing of the phrase is left mid-fade.
    expect(eyebrow()).toEqual(['Your last progress is back']);
  });

  // The report is keys and their values, resolved here rather than at the announcement: a transfer
  // lands in a layer that returns data and translates nothing.
  it('opens a transfer with its own phrase and says its report ONE line at a time', () => {
    mount({ reduced: true });
    act(() => announceArrival({
      kind: 'transferred',
      detail: [
        { key: 'arrival.transferred' },
        { key: 'arrival.transferred_ground', params: { cells: 174 } },
      ],
    }));
    settle();
    expect(eyebrow()).toEqual(["We've just arrived at"]);
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toEqual(['Your build came along']);
    wait(EYEBROW_SWAP_MS);
    // Never chained into one row: the loss is its own line and does not repeat the claim above it.
    expect(eyebrow()).toEqual(['Ground left behind: 174']);
    // And the last line stays: there is nothing after it to cycle to.
    wait(EYEBROW_SWAP_MS * 2);
    expect(eyebrow()).toEqual(['Ground left behind: 174']);
  });

  it('follows a locale changed while it is standing', () => {
    mount({ reduced: true });
    act(() => announceArrival({ kind: 'restored' }));
    settle();
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toEqual(['Your last progress is back']);
    act(() => useEditorStore.setState({ locale: 'zh' }));
    expect(eyebrow()).toEqual(['已恢复上次的进度']);
  });

  it('waits for the tour and comes up once it is over', () => {
    mount();
    act(() => useEditorStore.setState({ tourRunning: true }));
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    expect(screen.queryByTestId('arrival-toast')).toBeNull();
    act(() => useEditorStore.setState({ tourRunning: false }));
    settle();
    expect(screen.getByTestId('arrival-toast')).toBeTruthy();
  });

  it('waits behind the boot splash', () => {
    mount({ splashActive: true });
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    expect(screen.queryByTestId('arrival-toast')).toBeNull();
  });

  it('describes the map that arrived, whichever planet it is', () => {
    useEditorStore.setState({ gridState: mapOn(OTHER) });
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    expect(screen.getByText(OTHER.name.en)).toBeTruthy();
  });

  it('stands beside a saved-session offer rather than behind it', () => {
    const decline = vi.fn();
    offerRestoreDismiss(decline);
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    // Both at once: the card at the foot of the map asks whether to pick the last map back up, this
    // says which planet is under you. Neither answers the other by appearing.
    expect(screen.getByTestId('arrival-toast')).toBeTruthy();
    expect(eyebrow()).toEqual(["You're at"]);
    expect(decline).not.toHaveBeenCalled();
  });

  it('answers the standing offer when a HAND takes it', () => {
    const decline = vi.fn();
    offerRestoreDismiss(decline);
    mount({ reduced: true });
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    act(() => { fireEvent.click(screen.getByTestId('arrival-ok')); });
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it('answers it from the other button too, on the way to the planet chooser', () => {
    const decline = vi.fn();
    offerRestoreDismiss(decline);
    mount({ reduced: true });
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    act(() => { fireEvent.click(screen.getByTestId('arrival-switch')); });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().modals.newProject).toBe(true);
  });

  it('leaves the offer standing when the countdown presses its own OK', () => {
    // The fuse runs on rAF, so this one test drives that clock too; jsdom lays nothing out, so the
    // countdown's own drawing (gated on a measured width) needs one as well. That drawing is the
    // evidence the clock actually ran out: empty means fired, an offset of 1 being the whole
    // outline walked off its end. Nobody answered anything here, so the card at the foot of the map
    // is still asking.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
    try {
      const decline = vi.fn();
      offerRestoreDismiss(decline);
      mount({ reduced: true });
      act(() => announceArrival({ kind: 'boot' }));
      settle();
      const ring = screen.getByTestId('arrival-ok').querySelector('svg rect') as SVGRectElement;
      wait(announcedWait() * 1000 + 500);
      expect(ring.style.strokeDashoffset, 'the fuse really did burn down').toBe('1');
      expect(decline).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
  });

  it('swaps a standing notice to the restored arrival, rather than arriving twice', () => {
    mount({ reduced: true });
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    const card = screen.getByTestId('arrival-toast');
    const ok = screen.getByTestId('arrival-ok');
    wait(EYEBROW_SWAP_MS);
    act(() => announceArrival({ kind: 'restored' }));
    settle();
    // The same card, still standing: the words changed, the notice did not come in again.
    expect(screen.getByTestId('arrival-toast')).toBe(card);
    // The eyebrow starts over, so the phrase is said again before the restored line takes the line.
    expect(eyebrow()).toEqual(["You're at"]);
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toEqual(['Your last progress is back']);
    // And the countdown starts over with it: a fuse carried across the swap could be a second from
    // the end, taking the notice away before its new line had been said.
    expect(screen.getByTestId('arrival-ok')).not.toBe(ok);
  });

  /*
   * The box eases to the new words. jsdom lays nothing out, so the widths are stubbed and what is
   * pinned is the decision: a swap that changes the card's size starts a glide (the card clips
   * itself while its box travels, so nothing inside re-lays out), and reduced motion takes the new
   * size outright. How the glide feels is carried by the comment on `useCardResize`.
   */
  const withWidths = (run: (setWidth: (w: number) => void) => void) => {
    let width = 200;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => width,
    });
    try {
      run((w) => { width = w; });
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
  };

  it('eases its box to the new words when a resume swaps a standing notice', () => {
    withWidths((setWidth) => {
      mount();
      act(() => announceArrival({ kind: 'boot' }));
      settle();
      // An arrival flies in at its own size: there is nothing to glide from.
      expect(screen.getByTestId('arrival-row').style.overflow).toBe('');
      // The restored session was on another planet, so the name, the picture and the words are all
      // a different width.
      setWidth(320);
      act(() => announceArrival({ kind: 'restored' }));
      settle();
      expect(screen.getByTestId('arrival-row').style.overflow).toBe('hidden');
    });
  });

  it('brings the card with each line, since one line is not the width of the next', () => {
    withWidths((setWidth) => {
      mount();
      act(() => announceArrival({
        kind: 'transferred',
        detail: [{ key: 'arrival.transferred' }, { key: 'arrival.transferred_lost_none' }],
      }));
      settle();
      setWidth(320);
      wait(EYEBROW_SWAP_MS);
      expect(screen.getByTestId('arrival-row').style.overflow).toBe('hidden');
    });
  });

  /**
   * What the clip falls on. A box that is mid-travel is narrower or wider than what stands in it,
   * so something is cut for those few hundred ms — and the only thing whose width a change of
   * arrival changes is the words. With the two answers inside the clipped row they stood at its far
   * end: a card growing 60 px held them that far past the moving edge, and the second button was
   * drawn sliced down its right side. Outside it they are carried by the card's own edge.
   */
  it('carries the answers outside the box it clips, so a travelling card cannot cut one', () => {
    withWidths((setWidth) => {
      mount();
      act(() => announceArrival({ kind: 'boot' }));
      settle();
      setWidth(320);
      act(() => announceArrival({ kind: 'restored' }));
      settle();
      const row = screen.getByTestId('arrival-row');
      expect(row.style.overflow).toBe('hidden');
      for (const answer of ['arrival-ok', 'arrival-switch']) {
        expect(row.contains(screen.getByTestId(answer)), answer).toBe(false);
        expect(screen.getByTestId('arrival-toast').contains(screen.getByTestId(answer))).toBe(true);
      }
    });
  });

  it('takes the new size outright under reduced motion', () => {
    withWidths((setWidth) => {
      mount({ reduced: true });
      act(() => announceArrival({ kind: 'boot' }));
      settle();
      setWidth(320);
      act(() => announceArrival({ kind: 'restored' }));
      settle();
      const el = screen.getByTestId('arrival-row');
      // Nothing is travelling, so the row neither clips itself nor carries a width of its own.
      expect(el.style.overflow).toBe('');
      expect(el.style.width).toBe('');
    });
  });

  it('stands in a live region, so the arrival is announced rather than merely drawn', () => {
    mount();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
