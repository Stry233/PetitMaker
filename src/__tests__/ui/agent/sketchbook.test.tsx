/**
 * sketchbook.test.tsx — the idle dressing: what the card does, where it may stand, and what it does
 * not do.
 *
 * THE FOUR FACTS THIS FILE EXISTS FOR. Zero ideas renders NOTHING (the rest state stands honestly
 * without a card rather than dressing an empty analysis); a press FILLS the composer and sends
 * nothing; reduced motion is the complete still with no animation started at all; and the engine
 * stops with the card, so a folded panel leaves no rAF running for the app's life.
 *
 * jsdom has no Web Animations, so `Element.prototype.animate` is installed as a SPY for the length
 * of the file. That is what makes "no animation ran" an assertion rather than an accident of the
 * environment: without it every `animate` call is skipped by the component's own guard and the
 * reduced-motion case would pass over a component that animates everything.
 */
import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import type { PanelView } from '../../../agent/core/project-view';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { DreamOffice } from '../../../ui/agent/DreamOffice';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { Character } from '../../../ui/agent/character/Character';
import { Sketchbook, WASH_FLOOR } from '../../../ui/agent/sketchbook/Sketchbook';
import type { SketchIdea } from '../../../ui/agent/sketchbook/propose';
import { DREAM, SKETCH } from '../../../ui/agent/sketchbook/sketch-motion';
import { makeState } from '../../rules/_helpers';
import type { GridState } from '../../../core/model/types';

// The card's ground is a real capture off the live 2D renderer, which no jsdom run has. `MapShot`
// already answers "no renderer yet" with its placeholder, so this only keeps the async capture out
// of the way of the facts under test.
vi.mock('../../../canvas/thumbnail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../canvas/thumbnail')>(),
  renderThumbnail: async () => null,
}));

const LANE: SketchIdea = {
  kind: 'lane',
  capKey: 'agent3.sketch_lane_cap',
  orderKey: 'agent3.sketch_lane_order',
  dirKey: 'agent3.sketch_dir_south',
  params: { n: 34 },
  art: { shape: 'lane', from: { x: 4, y: 4 }, via: { x: 9, y: 11 }, to: { x: 15, y: 17 }, width: 2 },
};

const POND: SketchIdea = {
  kind: 'pond',
  capKey: 'agent3.sketch_pond_cap',
  orderKey: 'agent3.sketch_pond_order',
  dirKey: 'agent3.sketch_dir_east',
  params: { n: 12 },
  art: { shape: 'pond', cx: 14, cy: 8, rx: 6, ry: 4 },
};

const GROVE: SketchIdea = {
  kind: 'grove',
  capKey: 'agent3.sketch_grove_cap',
  orderKey: 'agent3.sketch_grove_order',
  dirKey: 'agent3.sketch_dir_north',
  params: { n: 3 },
  art: {
    shape: 'grove',
    pips: [
      { x: 5.5, y: 5.5, r: 1.1, standing: true },
      { x: 8.5, y: 6.5, r: 1.1, standing: true },
      { x: 6.5, y: 9.5, r: 0.9, standing: false },
    ],
  },
};

/** The words the card says for an idea, resolved exactly as the card resolves them. */
function said(idea: SketchIdea, which: 'capKey' | 'orderKey'): string {
  const en = translations.en;
  const dir = en[idea.dirKey]!;
  return (en[idea[which]] ?? '')
    .replace('{dir}', dir)
    .replace('{n}', String(idea.params.n));
}

let animate: ReturnType<typeof vi.fn>;
const REAL_ANIMATE = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

function mount(ideas: readonly SketchIdea[], onOrder = () => {}, reduced = false) {
  return render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider>
        <Sketchbook ideas={ideas} onOrder={onOrder} />
      </I18nProvider>
    </MotionConfig>,
  );
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', gridState: makeState(24, 24) as GridState });
  animate = vi.fn(() => ({ onfinish: null, cancel: () => {}, finished: Promise.resolve() }));
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  if (REAL_ANIMATE) Object.defineProperty(Element.prototype, 'animate', REAL_ANIMATE);
  else delete (Element.prototype as unknown as Record<string, unknown>).animate;
  useEditorStore.setState({ gridState: null });
});

describe('the card only stands where there is something to say', () => {
  /** Zero ideas is the honest rest, not an empty state to dress: a map with nothing to propose gets
   *  no card at all, and the panel's rest stands without it. */
  it('renders nothing at all for a map that offers nothing', () => {
    const { queryByTestId } = mount([]);
    expect(queryByTestId('sketchbook')).toBeNull();
    expect(queryByTestId('sketch-card')).toBeNull();
  });

  it('draws the first idea, its caption and the two lines around it', () => {
    const { getByTestId } = mount([LANE, POND]);
    expect(getByTestId('sketch-card').getAttribute('data-kind')).toBe('lane');
    expect(getByTestId('sketch-caption').textContent).toBe(said(LANE, 'capKey'));
    expect(getByTestId('sketchbook').textContent).toContain(translations.en['agent3.sketch_say']);
    expect(getByTestId('sketchbook').textContent).toContain(translations.en['agent3.sketch_note']);
  });

  /** The ground is the map's own photograph, and until the renderer answers the card WAITS: no drawn
   *  stand-in island, which would be a picture of a map nobody has. */
  it('waits on the real capture rather than drawing a stand-in island', () => {
    const { getByTestId } = mount([LANE]);
    const shot = within(getByTestId('sketch-thumb')).getByTestId('map-shot');
    expect(shot.getAttribute('data-shot')).toBe('pending');
    expect(shot.querySelector('img')).toBeNull();
    expect(shot.childElementCount, 'the house loader stands in the empty frame').toBeGreaterThan(0);
  });

  /**
   * AND THE TRACING PAPER HAS TO ANSWER A REAL ISLAND. The artifact's sketch stands on a drawn pale
   * plate, so a thin wash was all the separation its pencil needed; here the ground is the live map
   * at full saturation, and at 0.16 the wash was imperceptible — the dashed proposal competed with
   * the map's own road lines and read as one more thing painted on the island. The floor is exported
   * beside the value so a later tidy cannot walk it back to invisible in silence.
   */
  it('lays enough tracing paper for the pencil to read over a built island', () => {
    const { getByTestId } = mount([LANE]);
    const alpha = Number(/rgba?\([^)]*?([\d.]+)\s*\)$/.exec(getByTestId('sketch-wash').style.background)?.[1]);
    expect(Number.isFinite(alpha), getByTestId('sketch-wash').style.background).toBe(true);
    expect(alpha).toBeGreaterThanOrEqual(WASH_FLOOR);
    // And still a wash: an opaque plate would be the drawn stand-in island this card refuses.
    expect(alpha).toBeLessThan(0.75);
  });
});

describe('a press hands the order over', () => {
  it('gives the composer the standing idea\'s own words, and sends nothing', () => {
    const onOrder = vi.fn();
    const { getByTestId } = mount([LANE, POND], onOrder);

    fireEvent.click(getByTestId('sketch-card'));
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onOrder).toHaveBeenCalledWith(said(LANE, 'orderKey'));
    // The words are the ORDER, not the caption: one says what she sees, the other is what the user
    // would type.
    expect(onOrder.mock.calls[0]![0]).not.toBe(said(LANE, 'capKey'));
  });
});

describe('the figure', () => {
  /** Each family draws its own shape, and every one of them is drawn through the mask that reveals
   *  it tip-first: a figure with no mask is a dashed line that simply appears. */
  it('draws each family, every stroke behind a reveal mask', () => {
    for (const idea of [LANE, POND, GROVE]) {
      const view = mount([idea]);
      const figure = view.getByTestId('sketch-figure');
      expect(figure.getAttribute('data-kind')).toBe(idea.kind);
      const masks = figure.querySelectorAll('mask');
      const drawn = [...figure.querySelectorAll('path[mask]')];
      expect(masks.length, idea.kind).toBeGreaterThan(0);
      expect(drawn.length, idea.kind).toBe(masks.length);
      // And every drawn stroke is DASHED: the pencil never lays a solid line.
      for (const path of drawn) expect(path.getAttribute('stroke-dasharray'), idea.kind).toBeTruthy();
      view.unmount();
    }
  });

  /** A grove pips the trees that stand there and the ground beside them, one path each. */
  it('gives a grove one pip per tree, standing or offered', () => {
    const { getByTestId } = mount([GROVE]);
    expect(getByTestId('sketch-figure').querySelectorAll('path[mask]')).toHaveLength(3);
  });
});

describe('the pencil', () => {
  /** THE MASK'S DASHOFFSET IS WHAT RUNS. Animating the dashed shape's own offset slides the pattern
   *  along and reads as a solid line arriving; the mask lets the dashes appear tip-first and stay
   *  dashes, which is the whole of why the draw-in reads as drawing. */
  it('draws in by retreating the reveal mask, not by moving the dashes', () => {
    mount([LANE, POND]);
    const frames = animate.mock.calls.map((call) => call[0] as Keyframe[]);
    const drawn = frames.filter((kf) => kf.some((frame) => 'strokeDashoffset' in frame));
    expect(drawn.length, 'the figure draws itself in').toBeGreaterThan(0);
    for (const kf of drawn) {
      expect(Number(kf[0]!.strokeDashoffset)).toBeGreaterThan(0);
      expect(Number(kf[kf.length - 1]!.strokeDashoffset)).toBe(0);
    }
    // And it is the MASK's own copy that carries them, never the drawn path: the reveal stroke is
    // the white one inside the mask, and it wears no mask of its own.
    const runners = (animate.mock.contexts as Element[])
      .filter((_el, i) => (animate.mock.calls[i]![0] as Keyframe[]).some((f) => 'strokeDashoffset' in f));
    expect(runners.length).toBe(drawn.length);
    for (const el of runners) {
      expect(el.getAttribute('mask')).toBeNull();
      expect(el.getAttribute('stroke')).toBe('#fff');
    }
  });
});

/**
 * THE CAPTION SWAP (`sketchEngine.swapCap`): out, then the words underneath change, then in. jsdom
 * has no real frame clock to wait a 7.6s cycle out on, so the one rAF loop is stepped by hand —
 * `performance.now` pinned to the moment wanted, the loop's own last-registered callback invoked
 * directly. That is a fact about how this file drives the engine, not about the engine itself.
 */
describe('the caption', () => {
  function stepEngineTo(
    raf: MockInstance<(callback: FrameRequestCallback) => number>,
    now: MockInstance<() => number>,
    ms: number,
  ): void {
    now.mockReturnValue(ms);
    const cb = raf.mock.calls[raf.mock.calls.length - 1]![0];
    act(() => { cb(ms); });
  }

  it('fades the standing line out, swaps the words underneath, then fades the new line in', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    try {
      const { getByTestId } = mount([LANE, POND]);
      const capEl = getByTestId('sketch-caption');
      expect(capEl.textContent).toBe(said(LANE, 'capKey'));

      animate.mockClear();
      stepEngineTo(raf, now, SKETCH.cycle); // the next cycle: LANE gives way to POND

      const onCap = (calls: unknown[][]) => calls
        .map((call, i) => ({ call, el: animate.mock.contexts[i] as Element }))
        .filter(({ el }) => el === capEl);
      let capCalls = onCap(animate.mock.calls);
      expect(capCalls, 'the caption fades out, and nothing else touches this element').toHaveLength(1);
      expect(capCalls[0]!.call[0]).toEqual([{ opacity: 1 }, { opacity: 0 }]);
      expect(capCalls[0]!.call[1]).toMatchObject({ duration: SKETCH.capOut.dur, easing: SKETCH.capOut.easing });

      // The out beat has not finished: the words have not moved yet.
      expect(capEl.textContent).toBe(said(LANE, 'capKey'));

      const outIndex = animate.mock.calls.indexOf(capCalls[0]!.call as unknown as unknown[]);
      const outAnim = animate.mock.results[outIndex]!.value as { onfinish?: () => void };
      animate.mockClear();
      act(() => { outAnim.onfinish?.(); });

      // The swap landed, and the in beat played on the same element, risen from below.
      expect(capEl.textContent).toBe(said(POND, 'capKey'));
      capCalls = onCap(animate.mock.calls);
      expect(capCalls).toHaveLength(1);
      expect(capCalls[0]!.call[0]).toEqual([
        { opacity: 0, transform: `translateY(${SKETCH.capRise}px)` },
        { opacity: 1, transform: 'none' },
      ]);
      expect(capCalls[0]!.call[1]).toMatchObject({ duration: SKETCH.capIn.dur, easing: SKETCH.capIn.easing });
    } finally {
      now.mockRestore();
      raf.mockRestore();
    }
  });
});

describe('reduced motion is the complete still', () => {
  it('draws the first idea fully in and starts no animation at all', () => {
    const { getByTestId } = mount([LANE, POND, GROVE], () => {}, true);

    expect(getByTestId('sketch-caption').textContent).toBe(said(LANE, 'capKey'));
    // Every reveal mask is fully retreated: the figure is drawn, not mid-draw.
    const reveals = [...getByTestId('sketch-figure').querySelectorAll('mask path')];
    expect(reveals.length).toBeGreaterThan(0);
    for (const path of reveals) expect(path.getAttribute('stroke-dashoffset')).toBe('0');
    expect(animate, 'nothing moves under reduced motion').not.toHaveBeenCalled();
  });

  it('runs no rotation loop, so the still stays the still', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = mount([LANE, POND], () => {}, true);
    expect(raf).not.toHaveBeenCalled();
    unmount();
    raf.mockRestore();
  });
});

describe('the engine is gated by the card', () => {
  /** The rotation is one rAF loop and the card owns it: unmounting (a job starting, the panel
   *  folding) has to end it, or a session leaves a loop running for the app's life. */
  it('cancels its loop when the card goes away', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = mount([LANE, POND]);
    expect(raf, 'the loop runs while the card stands').toHaveBeenCalled();
    const started = raf.mock.results.map((r) => r.value as number);

    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(started).toContain(cancel.mock.calls[0]![0]);
    cancel.mockRestore();
    raf.mockRestore();
  });

  /** One idea is a still by construction: there is nothing to rotate to, and a wipe with nothing
   *  behind it would blank the card every few seconds. */
  it('starts no loop for a map that offers exactly one idea', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { getByTestId, unmount } = mount([LANE]);
    expect(getByTestId('sketch-card')).toBeTruthy();
    expect(raf).not.toHaveBeenCalled();
    unmount();
    raf.mockRestore();
  });
});

/**
 * WHERE THE CARD MAY STAND, which is the panel's decision rather than the card's.
 *
 * The rest states carry it and nothing else does: a job in flight, a settled record still to be
 * read, a question, a screen over the zone — each of those is the panel having something to say, and
 * the dressing would be talking over it. Wherever it does stand it stands LAST, nearest the
 * composer, so the region under the user's hand reads the same in every rest.
 */
describe('the panel seats the card', () => {
  const marker = <div data-testid="sketch-marker" />;

  function stand(over: Partial<PanelView> = {}, props: Record<string, unknown> = {}) {
    return render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={{
              phase: 'idle', jobs: [], queuedSteers: [], suggestion: null, lastEventAt: 0,
              vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
              ...over,
            }}
            connected
            now={0}
            sketchbook={marker}
            onSend={() => {}}
            onStop={() => {}}
            onPause={() => {}}
            onGateAnswer={() => {}}
            {...props}
          />
        </I18nProvider>
      </MotionConfig>,
    );
  }

  it('stands it LAST in the job zone at rest', () => {
    const { getByTestId } = stand();
    const zone = getByTestId('panel-job-zone');
    const card = getByTestId('sketch-marker');
    expect(zone.contains(card)).toBe(true);
    // The card rides its seat (the box the docked layout pushes to the zone's foot), and the seat
    // is what stands last.
    const seat = getByTestId('sketch-seat');
    expect(seat.contains(card)).toBe(true);
    expect(zone.lastElementChild, 'nearest the composer').toBe(seat);
  });

  it('keeps it last with the state\'s own news above it', () => {
    const past = {
      orderSeq: 1, orderText: 'lay the boardwalk', orderAt: 0, outcome: 'done' as const,
      asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    };
    // FILED, so the record is a row in the strip rather than a card still standing: a card is the
    // panel having something to say, and the dressing waits for it to be put away.
    const { getByTestId } = stand({ jobs: [past] }, { filed: new Set([1]) });
    const zone = getByTestId('panel-job-zone');
    expect(zone.contains(getByTestId('history-strip')), 'the news reads first').toBe(true);
    expect(zone.lastElementChild).toBe(getByTestId('sketch-seat'));
    expect(getByTestId('sketch-seat').contains(getByTestId('sketch-marker'))).toBe(true);
  });

  /**
   * THE PRESS REACHES THE FIELD, end to end: the card hands its order up, the caller keys it, and
   * the composer takes the words and focuses. Nothing is sent — the send button is still the user's.
   */
  it('fills the composer with the pressed order and sends nothing', () => {
    const onSend = vi.fn();
    function Wired() {
      const [fill, setFill] = useState<{ text: string; seq: number } | undefined>(undefined);
      return (
        <MotionConfig reducedMotion="always">
          <I18nProvider>
            <PanelShell
              view={{
                phase: 'idle', jobs: [], queuedSteers: [], suggestion: null, lastEventAt: 0,
                vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
              }}
              connected
              now={0}
              sketchbook={(
                <Sketchbook
                  ideas={[LANE]}
                  onOrder={(text) => setFill((last) => ({ text, seq: (last?.seq ?? 0) + 1 }))}
                />
              )}
              {...(fill ? { fill } : {})}
              onSend={onSend}
              onStop={() => {}}
              onPause={() => {}}
              onGateAnswer={() => {}}
            />
          </I18nProvider>
        </MotionConfig>
      );
    }
    const { getByTestId } = render(<Wired />);
    const field = () => getByTestId('composer-input') as HTMLInputElement;
    expect(field().value).toBe('');

    fireEvent.click(getByTestId('sketch-card'));
    expect(field().value).toBe(said(LANE, 'orderKey'));
    expect(document.activeElement).toBe(field());
    expect(onSend, 'the sketch suggests, the user sends').not.toHaveBeenCalled();
  });

  it('withholds it while a job is in flight', () => {
    const live = {
      orderSeq: 1, orderText: 'build a village', orderAt: 0,
      asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    };
    const { queryByTestId } = stand({ phase: 'thinking', current: live });
    expect(queryByTestId('sketch-marker')).toBeNull();
  });

  it('withholds it behind the keyless rest, which has its own dressing', () => {
    const { queryByTestId, getByTestId } = stand({}, { connected: false });
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(queryByTestId('sketch-marker')).toBeNull();
  });

  /**
   * THE RESUME OFFER, the one rest `dressed` excludes BY CONSTRUCTION rather than by name
   * (`view.current` is "the running/paused job", set here too): this is that exclusion's own case,
   * standing beside the in-flight one above rather than assumed from it. A paused job still holds
   * the desk, and the card is not what stands there instead.
   */
  it('withholds it behind a paused job, the resume offer', () => {
    const paused = {
      orderSeq: 1, orderText: 'build a village', orderAt: 0,
      asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    };
    const { queryByTestId } = stand({ phase: 'paused', current: paused });
    expect(queryByTestId('sketch-marker')).toBeNull();
  });
});

/**
 * THE DREAMING OFFICE. The board is a queue of inert pictures and the one press on the screen is
 * Connect; the plume is the character's, published to her rather than drawn here, and it is put away
 * when the screen goes however it goes.
 */
describe('the dreaming office', () => {
  /** The character stands BESIDE the screen, exactly as she does in the app: she is one layer
   *  outside the panel, and the plume travels to her rather than being drawn on the screen. */
  function dream(reduced = false, onConnect = () => {}) {
    return render(
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        <I18nProvider>
          <Character pose="sleeping" size={72} />
          <DreamOffice onConnect={onConnect} />
        </I18nProvider>
      </MotionConfig>,
    );
  }

  /** What the character is wearing at her shoulder: the plume's own state, or `off` where she wears
   *  no plume at all. */
  const plume = (): string =>
    document.querySelector('[data-part="dream-badge"]')?.getAttribute('data-dream') ?? 'off';

  it('stands three inert order slips and one verb', () => {
    const { getByTestId, getAllByTestId } = dream();
    expect(getAllByTestId('dream-row')).toHaveLength(3);
    // INERT: a dream is not a menu. Nothing on the board is pressable.
    for (const row of getAllByTestId('dream-row')) {
      expect(row.querySelector('button')).toBeNull();
      expect(row.tagName).not.toBe('BUTTON');
    }
    expect(getByTestId('dream-connect').textContent).toBe(translations.en['agent3.dream_connect']);
  });

  it('answers Connect and nothing else', () => {
    const onConnect = vi.fn();
    const { getByTestId } = dream(false, onConnect);
    fireEvent.click(getByTestId('dream-connect'));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  /** The plume is the character's own, and it goes away with the screen: a panel that connected
   *  would otherwise wear the zzz over a working desk. */
  it('takes the plume up while it stands and puts it down when it goes', () => {
    const { unmount } = dream();
    expect(plume()).not.toBe('off');
    unmount();
    expect(plume()).toBe('off');
  });

  it('runs no loop under reduced motion, and wears the first order\'s glyph', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { unmount } = dream(true);
    expect(raf).not.toHaveBeenCalled();
    expect(plume()).toBe('pw-object-place');
    unmount();
    raf.mockRestore();
  });

  it('cancels its loop when the screen goes away', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = dream();
    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });

  /**
   * THE ROW THAT JUST LEFT (`dreamEngine.rotateOnce`'s ghost). jsdom has no real frame clock to wait
   * a 3.8s cycle out on, so the loop is stepped by hand — `performance.now` pinned to the next
   * cycle, the loop's own last-registered callback invoked directly.
   */
  it('fades the departed row over the board rather than dropping it outright', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    try {
      const { getByTestId, queryByTestId } = dream();
      expect(queryByTestId('dream-row-leaving'), 'nothing has left yet').toBeNull();

      now.mockReturnValue(DREAM.cycle);
      const cb = raf.mock.calls[raf.mock.calls.length - 1]![0] as FrameRequestCallback;
      animate.mockClear();
      // Async: the new row's `MapShot` fires off a (mocked) capture whose promise settles on the
      // next microtask, which is what this flushes before the test's own assertions run.
      await act(async () => { cb(DREAM.cycle); });

      // The row that stood first (DREAMS[0], top of the beat-0 window) is the one that left.
      const leaving = getByTestId('dream-row-leaving');
      expect(leaving.dataset.order).toBe('village');

      const onLeaving = animate.mock.calls
        .map((call, i) => ({ call, el: animate.mock.contexts[i] as Element }))
        .filter(({ el }) => el === leaving);
      expect(onLeaving).toHaveLength(1);
      expect(onLeaving[0]!.call[0]).toEqual([
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translate(-18px,-6px) scale(.98)' },
      ]);
      expect(onLeaving[0]!.call[1]).toMatchObject({ duration: DREAM.rowOut.dur, easing: DREAM.rowOut.easing });
    } finally {
      now.mockRestore();
      raf.mockRestore();
    }
  });
});
