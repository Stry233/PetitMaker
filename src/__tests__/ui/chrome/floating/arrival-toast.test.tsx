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
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../../_support/tour';
import { I18nProvider } from '../../../../i18n/context';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { spec } from '../../../_support/spec';
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

function mount(props: { splashActive?: boolean; reduced?: boolean; upright?: boolean } = {}) {
  const toast = (
    <MotionConfig reducedMotion={props.reduced ? 'always' : 'never'}>
      <I18nProvider>
        <ArrivalToast splashActive={props.splashActive ?? false} />
      </I18nProvider>
    </MotionConfig>
  );
  return render(props.upright ? <InputModeProvider inputMode="touch" shape="portrait">{toast}</InputModeProvider> : toast);
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
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  const st = useEditorStore.getState();
  useEditorStore.setState({
    gridState: mapOn(),
    locale: 'en',
    tourRunning: false,

    modals: { ...st.modals, newProject: false },
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

  it('stands centred over the work on its own width', () => {
    mount();
    act(() => announceArrival({ kind: 'boot' }));
    settle();
    const band = screen.getByTestId('arrival-toast').closest<HTMLElement>('[role="status"]')!;
    expect(band.style.transform).toBe('translateX(-50%)');
    expect(band.style.right).toBe('');
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
    // The loss is its own line, never chained onto the claim above it.
    expect(eyebrow()).toEqual(['Ground left behind: 174']);
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
    // The restore card and the arrival notice stand together; neither answers the other by appearing.
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
    // The fuse runs on rAF, and its drawing needs a measured width that jsdom lacks. A dash offset
    // of 1 shows the fuse burnt down; nobody answered, so the restore card still asks.
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
    expect(screen.getByTestId('arrival-toast')).toBe(card);
    // The eyebrow starts over.
    expect(eyebrow()).toEqual(["You're at"]);
    wait(EYEBROW_SWAP_MS);
    expect(eyebrow()).toEqual(['Your last progress is back']);
    // The countdown restarts too, or a nearly spent fuse could dismiss the new line unread.
    expect(screen.getByTestId('arrival-ok')).not.toBe(ok);
  });

  /*
   * jsdom lays nothing out, so widths are stubbed and the decision is what is checked: a size change
   * starts a glide, during which the card clips itself, and reduced motion takes the new size outright.
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
      // An arrival flies in at its own size.
      expect(screen.getByTestId('arrival-row').style.overflow).toBe('');
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

  /** Inside the clipped row the buttons would stand past a growing card's moving edge and be sliced;
   *  outside it they ride the card's own edge. */
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

  /** Every line on screen, the outgoing one included, is held to one line and cut with an ellipsis
   *  that its title completes, so a swap can only change the notice's width. */
  const oneLine = () => {
    const lines = screen.getAllByTestId('arrival-eyebrow');
    for (const line of lines) {
      const style = getComputedStyle(line);
      expect(style.whiteSpace, line.textContent!).toBe('nowrap');
      expect(style.textOverflow, line.textContent!).toBe('ellipsis');
      expect(line.title).toBe(line.textContent);
    }
    return lines.map((line) => line.textContent);
  };

  for (const reduced of [false, true]) {
    spec('UI-28', `keeps the upright notice's words on one line while a resume swaps them${reduced ? ', under reduced motion too' : ''}`, () => {
      withWidths((setWidth) => {
        mount({ upright: true, reduced });
        act(() => announceArrival({ kind: 'boot' }));
        settle();
        act(() => announceArrival({ kind: 'restored' }));
        settle();
        expect(oneLine()).toEqual(["You're at"]);
        setWidth(320);
        wait(EYEBROW_SWAP_MS);
        expect(oneLine()).toContain('Your last progress is back');
        // Full motion glides the width to the new line; reduced motion takes it at once.
        expect(screen.getByTestId('arrival-row').style.overflow).toBe(reduced ? '' : 'hidden');
      });
    });
  }

  it('takes the new size outright under reduced motion', () => {
    withWidths((setWidth) => {
      mount({ reduced: true });
      act(() => announceArrival({ kind: 'boot' }));
      settle();
      setWidth(320);
      act(() => announceArrival({ kind: 'restored' }));
      settle();
      const el = screen.getByTestId('arrival-row');
      expect(el.style.overflow).toBe('');
      expect(el.style.width).toBe('');
    });
  });

  it('stands in a live region, so the arrival is announced rather than merely drawn', () => {
    mount();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
