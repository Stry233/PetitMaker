/**
 * The arrival notice as it is actually seen: which planet it names, when it may say so, and the
 * eyebrow's one swap.
 *
 * The gate's own reasoning is unit-tested next door (`arrival-gate.test.ts`); what is pinned here is
 * that the component collects the right facts and RETRIES when they change — an arrival announced
 * under the tour must come up after it, not be lost to it.
 *
 * FAKE TIMERS, so the eyebrow's three seconds cost nothing. That is also why the two dismissals are
 * a file of their own (`arrival-toast-dismiss.test.tsx`): a card leaves on an exit animation, Framer's frame loop stops running for
 * the rest of a file that has installed fake timers even once, and mixing the two clocks in one
 * file leaves the exit permanently unplayed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import {
  ARRIVAL_AFTER_S, ArrivalToast, EYEBROW_SWAP_MS, arrivalFuseS,
} from '../../../ui/chrome/floating/ArrivalToast';
import { __resetArrivals, announceArrival } from '../../../core/runtime/arrival-bus';
import { __resetRestoreOffer, offerRestoreDismiss } from '../../../core/runtime/restore-offer';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { getMapTemplate, MAP_LIST } from '../../../config/maps';
import { createGrid } from '../../../core/model/grid-model';
import type { GridState } from '../../../core/model/types';

const HEXIA = getMapTemplate('hexia');
/** The second planet, for the switch: the notice names whichever map is live. */
const OTHER = MAP_LIST.find((m) => m.id !== HEXIA.id)!;

function mapOn(template = HEXIA): GridState {
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
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

/** What the eyebrow is SAYING. The hidden strut beside it is a width and never a line, so it is
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
    expect(eyebrow()).toEqual(['You are at']);
    expect(screen.getByText(HEXIA.name.en)).toBeTruthy();
  });

  it('leaves a plain boot on its one line', () => {
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    wait(EYEBROW_SWAP_MS * 2);
    expect(eyebrow()).toEqual(['You are at']);
  });

  it('fades a restored session from the phrase to its own line', () => {
    mount();
    act(() => announceArrival({ kind: 'restored' }));
    settle();
    expect(eyebrow()).toEqual(['You are at']);
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toContain('Your last progress is back');
  });

  it('cuts to the detail under reduced motion, with nothing left of the phrase', () => {
    mount({ reduced: true });
    act(() => announceArrival({ kind: 'restored' }));
    settle();
    expect(eyebrow()).toEqual(['You are at']);
    wait(EYEBROW_SWAP_MS);
    // A cut: one line, and it is the detail. Nothing of the phrase is left mid-fade.
    expect(eyebrow()).toEqual(['Your last progress is back']);
  });

  // The report is KEYS and their values, resolved here rather than at the announcement: a transfer
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
    expect(eyebrow()).toEqual(['You are at']);
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
    // evidence the clock actually ran out: EMPTY MEANS FIRED, an offset of 1 being the whole
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
      wait(ARRIVAL_AFTER_S * 1000 + 500);
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
    expect(eyebrow()).toEqual(['You are at']);
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toEqual(['Your last progress is back']);
    // And the countdown starts over with it: a fuse carried across the swap could be a second from
    // the end, taking the notice away before its new line had been said.
    expect(screen.getByTestId('arrival-ok')).not.toBe(ok);
  });

  /*
   * THE BOX EASES TO THE NEW WORDS. jsdom lays nothing out, so the widths are stubbed and what is
   * pinned is the DECISION: a swap that changes the card's size starts a glide (the card clips
   * itself while its box travels, so nothing inside re-lays out), and reduced motion takes the new
   * size outright. How the glide FEELS is carried by the comment on `useCardResize`.
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
      // An arrival flies in at its own size: there is nothing to glide FROM.
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
   * WHAT THE CLIP FALLS ON. A box that is mid-travel is narrower or wider than what stands in it,
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

  /*
   * THE COUNTDOWN OUTLIVES THE WORDS. A line that arrives after the notice has taken itself away
   * was never said, so the fuse is the cycle's own spend plus time to read what landed.
   */
  it('gives the last line the same reading time as a notice with one thing to say', () => {
    const cadence = EYEBROW_SWAP_MS / 1000;
    expect(arrivalFuseS(0)).toBe(ARRIVAL_AFTER_S);
    // One line lands at 3s, and 3 plus a beat is less than a visitor needs, so the floor holds.
    expect(arrivalFuseS(1)).toBe(ARRIVAL_AFTER_S);
    expect(arrivalFuseS(2)).toBe(10);
    expect(arrivalFuseS(3)).toBe(13);
    // The invariant behind those numbers: whatever the report's length, the last line is on screen
    // with time left on the clock.
    for (const lines of [0, 1, 2, 3, 5, 9]) {
      expect(arrivalFuseS(lines)).toBeGreaterThan(lines * cadence);
    }
  });

  it('stands in a live region, so the arrival is announced rather than merely drawn', () => {
    mount();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
