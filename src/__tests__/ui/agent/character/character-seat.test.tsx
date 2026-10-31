// @vitest-environment jsdom
/**
 * The character is one `fixed` element placed from a seat's measured rect, so she follows window
 * resizes and UI zoom between her folded box and the desk seat. jsdom lays nothing out, so seat rects
 * are stubbed and the inline styles the placement writes are asserted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { DeskHeader } from '../../../../ui/agent/desk/DeskHeader';
import { Character, getCharacterHandle } from '../../../../ui/agent/character/Character';
import { CharacterHost } from '../../../../ui/agent/character/CharacterHost';
import {
  carryStep, parkCharacter, popCharacter, restingSeat, seatBox, setCarry,
  setDeskSeat, setPanelCarriage, showCharacter,
} from '../../../../ui/agent/character/seat';
import { useEditorStore } from '../../../../state/store';
import { amplitude, outSeconds, overshootAt, seconds } from '../../../../ui/design/motion';
import { CHARACTER_SEAT, PANEL_LEFT, PANEL_PLATE_PAD, panelTop } from '../../../../ui/shell/panel-frame';
import { JOB_ZONE_FLOOR, PINNED_HEIGHT } from '../../../../ui/agent/PanelShell';
import { frameZoom, resolveCss } from '../../shell/_resolve-css';
import { poseLegacyZoom } from '../../../_support/legacy-zoom';

/** Puts the gesture at `at` along `step` and places both halves there, as a resize re-placement does. */
function place(seat: Parameters<typeof parkCharacter>[0], step: ReturnType<typeof carryStep>, at: number): void {
  setCarry(at, step);
  parkCharacter(seat);
}

/** How far inside the seat she stands, at the box's own declared size. */
const PAD = CHARACTER_SEAT.pad;
/** The most she may travel between her two seats: her own folded width. */
const SEAT_TRAVEL_MAX = CHARACTER_SEAT.w;
const SEAT = CHARACTER_SEAT.w;

function stubRect(el: Element, left: number, top: number, size: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left, top, width: size, height: size,
      right: left + size, bottom: top + size, x: left, y: top, toJSON: () => ({}),
    }),
  });
}

/** Her seat as an empty box with the one live Character beside it, as `CharacterHost` mounts them. */
function Host({ room }: { room: string }) {
  const seat = useRef<HTMLDivElement>(null);
  useEffect(() => { parkCharacter(seatBox(seat.current)); }, [room]);
  return (
    <>
      <div ref={seat} data-testid="seat" />
      <Character pose="idle" size={40} />
    </>
  );
}

/** The desk at rest; reduced motion keeps the card's flip and her WAAPI calls, which jsdom lacks, away. */
function renderDesk() {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <DeskHeader
          view={{
            phase: 'idle', jobs: [], queuedSteers: [], suggestion: null, lastEventAt: 0,
            vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
          }}
          now={0}
        />
      </I18nProvider>
    </MotionConfig>,
  );
}

describe('the character stands in her seat', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  beforeEach(() => {
    // jsdom has no Web Animations API.
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
  });
  afterEach(() => {
    cleanup();
    (Element.prototype as any).animate = realAnimate;
  });

  it('places her inside the seat, at the seat less its own pad', () => {
    const view = render(<Host room="boot" />);
    stubRect(view.getByTestId('seat'), 70, 133, SEAT);
    act(() => { view.rerender(<Host room="1280x800@1" />); });

    const her = getCharacterHandle()!.el;
    expect(her.style.position).toBe('fixed');
    expect(her.style.left).toBe(`${70 + PAD}px`);
    expect(her.style.top).toBe(`${133 + PAD}px`);
    expect(her.style.width).toBe(`${SEAT - PAD * 2}px`);
  });

  it('follows the seat when the window or the interface scale moves it', () => {
    const view = render(<Host room="boot" />);
    stubRect(view.getByTestId('seat'), 70, 133, SEAT);
    act(() => { view.rerender(<Host room="1280x800@1" />); });

    stubRect(view.getByTestId('seat'), 53.8, 128.5, SEAT);
    act(() => { view.rerender(<Host room="1024x768@1" />); });
    const her = getCharacterHandle()!.el;
    expect(her.style.left).toBe(`${53.8 + PAD}px`);
    expect(her.style.top).toBe(`${128.5 + PAD}px`);
  });

  /** The seat is declared in frame px and measured in window px, so the pad scales with the frame's zoom. */
  it('reads the seat in screen pixels on an engine that measures zoomed subtrees in their own pixels', () => {
    const view = render(<div data-testid="frame"><Host room="boot" /></div>);
    const frame = view.getByTestId('frame');
    // Inside a zoom 0.5 frame the seat's own-pixel reading is twice its screen size.
    stubRect(view.getByTestId('seat'), 100, 200, SEAT * 2);
    const restore = poseLegacyZoom((node) => (node === frame ? 0.5 : 1));
    try {
      act(() => { view.rerender(<div data-testid="frame"><Host room="legacy" /></div>); });
      const her = getCharacterHandle()!.el;
      expect(her.style.left).toBe(`${50 + PAD}px`);
      expect(her.style.top).toBe(`${100 + PAD}px`);
      expect(her.style.width).toBe(`${SEAT - PAD * 2}px`);
    } finally {
      restore();
    }
  });

  it('scales the pad with the measured box', () => {
    const view = render(<Host room="boot" />);
    stubRect(view.getByTestId('seat'), 0, 0, SEAT * 2);
    act(() => { view.rerender(<Host room="zoomed" />); });
    const her = getCharacterHandle()!.el;
    expect(her.style.left).toBe(`${PAD * 2}px`);
    expect(her.style.width).toBe(`${SEAT * 2 - PAD * 4}px`);
  });
});

/**
 * The frame's zoom is React state flushed between the window's resize listeners, so anything measured
 * during the dispatch sees the old layout. One frame after the event she wears the new layout's placement.
 */
describe('the seat survives a window resize', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  beforeEach(() => {
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  });
  afterEach(() => {
    cleanup();
    (Element.prototype as any).animate = realAnimate;
  });

  it('wears the placement of the layout the resize produced, not the one its listeners saw', async () => {
    const entrance = document.createElement('div');
    stubRect(entrance, 88, 166, SEAT);
    render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <CharacterHost entranceRef={{ current: entrance }} open={false} connected size={60} />
        </I18nProvider>
      </MotionConfig>,
    );
    const her = getCharacterHandle()!.el;
    expect(her.style.left).toBe(`${88 + PAD}px`);

    // The box moves only when the frame re-renders at its new fit, after the event.
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1040 });
      window.dispatchEvent(new Event('resize'));
    });
    stubRect(entrance, 71, 135, SEAT);

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(her.style.left).toBe(`${71 + PAD}px`);
    expect(her.style.top).toBe(`${135 + PAD}px`);
    expect(her.style.width).toBe(`${SEAT - PAD * 2}px`);
  });

  it('recovers the first layout when the window grows back', async () => {
    const entrance = document.createElement('div');
    stubRect(entrance, 71, 135, SEAT);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1040 });
    render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <CharacterHost entranceRef={{ current: entrance }} open={false} connected size={60} />
        </I18nProvider>
      </MotionConfig>,
    );
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
      window.dispatchEvent(new Event('resize'));
    });
    stubRect(entrance, 88, 166, SEAT);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const her = getCharacterHandle()!.el;
    expect(her.style.left).toBe(`${88 + PAD}px`);
    expect(her.style.top).toBe(`${166 + PAD}px`);
  });
});

/**
 * The column's edges are the frame's and the desk seat sits at the plate's padding beside the dock card,
 * so her walk from the folded box to the desk seat is what remains, and it stays within her own size.
 */
describe('the panel stands on the grid and she steps to the desk', () => {
  /** The panel's least height, from the same two constants `PanelColumn` uses. */
  const LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;

  /** The desk seat at a window, in frame px: the column's clamped top-left plus the plate's padding. */
  const deskSeatAt = (w: number, h: number, ui: number) => ({
    left: PANEL_LEFT + PANEL_PLATE_PAD,
    top: resolveCss(panelTop(LEAST), h, frameZoom(w, h, ui)) + PANEL_PLATE_PAD,
  });

  /** The desk's row is top-aligned, so a seat with no margins is flush with the dock card's top edge. */
  it('reserves the seat flush with the status card, with no offset of its own', () => {
    const view = renderDesk();
    const slot = view.getByTestId('desk-header-char-slot');
    expect(slot.style.marginTop).toBe('');
    expect(slot.style.marginLeft).toBe('');
    expect(view.getByTestId('desk-header').style.alignItems).toBe('flex-start');
  });

  /**
   * The column's top yields to a short window at a large UI zoom while her folded box does not, so the
   * travel varies; it must never exceed her size, or the collapse reads as a card flying across.
   */
  it('keeps the fold inside her own size at every window and zoom', () => {
    for (const [w, h] of [
      [1280, 800], [1440, 900], [1024, 768], [1680, 1050], [1920, 720], [1280, 700], [768, 1024],
    ] as const) {
      for (const ui of [0.6, 0.8, 1, 1.25, 1.4, 1.6, 1.8]) {
        const seat = deskSeatAt(w, h, ui);
        const travel = Math.hypot(seat.left - CHARACTER_SEAT.left, seat.top - CHARACTER_SEAT.top);
        expect(travel, `${w}x${h} ui${ui}`).toBeLessThanOrEqual(SEAT_TRAVEL_MAX);
      }
    }
  });

  /** At the frame's reference window. */
  it('puts the desk seat down and to the right of her folded box', () => {
    const seat = deskSeatAt(1280, 800, 1);
    expect(seat.left).toBeGreaterThan(CHARACTER_SEAT.left);
    expect(seat.top).toBeGreaterThan(CHARACTER_SEAT.top);
  });
});

/**
 * One number says how far the collapse has left to travel; in the same call the carriage takes it as a
 * transform and she is placed at her seat plus the same remainder. Two animations on one curve would
 * drift (one runs on the compositor, the other through layout).
 */
describe('the panel and the character are one object', () => {
  afterEach(() => {
    cleanup();
    setPanelCarriage(null);
    setCarry(1, { left: 0, top: 0, scale: 1 });
  });

  /** Her seat inside the panel and her folded box outside it, as the host measures them. */
  const SEAT = { left: 100, top: 200, width: CHARACTER_SEAT.w - PAD * 2 };
  const FOLDED = { left: 78, top: 188, width: CHARACTER_SEAT.w - PAD * 2 };

  function carriage(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    setPanelCarriage(el);
    return el;
  }

  const shiftOf = (el: HTMLElement): { x: number; y: number } => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform);
    return m ? { x: parseFloat(m[1] ?? '0'), y: parseFloat(m[2] ?? '0') } : { x: 0, y: 0 };
  };

  it('measures the travel as the offset between the two seats, in the panel\'s own px', () => {
    const step = carryStep(SEAT, FOLDED);
    expect(step.scale).toBe(SEAT.width / (CHARACTER_SEAT.w - PAD * 2));
    expect(step.left).toBeCloseTo((FOLDED.left - SEAT.left) / step.scale, 6);
    expect(step.top).toBeCloseTo((FOLDED.top - SEAT.top) / step.scale, 6);
  });

  it('holds her offset inside the panel at every point of the gesture', () => {
    render(<Character pose="idle" size={40} />);
    const box = carriage();
    const step = carryStep(SEAT, FOLDED);
    const her = getCharacterHandle()!.el;
    for (let n = 0; n <= 20; n += 1) {
      place(SEAT, step, n / 20);
      const shift = shiftOf(box);
      expect(parseFloat(her.style.left) - shift.x * step.scale).toBeCloseTo(SEAT.left, 6);
      expect(parseFloat(her.style.top) - shift.y * step.scale).toBeCloseTo(SEAT.top, 6);
    }
  });

  it('lands the panel at rest and her seat on her button at the two ends', () => {
    render(<Character pose="idle" size={40} />);
    const box = carriage();
    const step = carryStep(SEAT, FOLDED);
    const her = getCharacterHandle()!.el;

    place(SEAT, step, 1);
    expect(box.style.transform).toBe('none');
    expect(her.style.left).toBe(`${SEAT.left}px`);

    place(SEAT, step, 0);
    expect(shiftOf(box).x).toBeCloseTo(step.left, 6);
    expect(parseFloat(her.style.left)).toBeCloseTo(FOLDED.left, 6);
    expect(parseFloat(her.style.top)).toBeCloseTo(FOLDED.top, 6);
  });

  /** A scale would change the measured rect of the desk seat inside the carriage while travel is read off it. */
  it('never scales the carriage', () => {
    const box = carriage();
    const step = carryStep(SEAT, FOLDED);
    for (let n = 0; n <= 4; n += 1) {
      place(SEAT, step, n / 4);
      expect(box.style.transform).not.toContain('scale');
    }
  });

  /** Read raw, the travelling slot would shrink the remaining distance every frame and stop half way. */
  it('takes the carriage\'s own displacement back out of a seat inside it', () => {
    const step = carryStep(SEAT, FOLDED);
    place(SEAT, step, 0);
    const rest = restingSeat({ ...SEAT, left: FOLDED.left, top: FOLDED.top })!;
    expect(rest.left).toBeCloseTo(SEAT.left, 6);
    expect(rest.top).toBeCloseTo(SEAT.top, 6);
  });

  it('places her alone where no carriage has been handed in', () => {
    render(<Character pose="idle" size={40} />);
    setPanelCarriage(null);
    place(SEAT, carryStep(SEAT, FOLDED), 1);
    expect(getCharacterHandle()!.el.style.left).toBe(`${SEAT.left}px`);
  });
});

/**
 * Docked, the sheet is the whole motion. A collapse over a docked panel reads open=false with the stage
 * still at the ground, and the fold's travel there would jump the window-tall ground on the press.
 */
describe('the docked ground takes no gesture travel', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  beforeEach(() => {
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    useEditorStore.setState({ assistantPinned: true, assistantOpen: true, uiZoom: 1 });
  });
  afterEach(() => {
    cleanup();
    setDeskSeat(null);
    setPanelCarriage(null);
    setCarry(1, { left: 0, top: 0, scale: 1 });
    useEditorStore.setState({ assistantPinned: false, assistantOpen: false });
    (Element.prototype as any).animate = realAnimate;
  });

  it('keeps the carriage at rest and her at the desk when a collapse lands over a dock', () => {
    const entrance = document.createElement('div');
    stubRect(entrance, 78, 188, SEAT);
    const desk = document.createElement('div');
    stubRect(desk, 100, 200, SEAT);
    document.body.appendChild(desk);
    setDeskSeat(desk);
    const box = document.createElement('div');
    document.body.appendChild(box);
    setPanelCarriage(box);

    render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <CharacterHost entranceRef={{ current: entrance }} open={false} connected size={60} />
        </I18nProvider>
      </MotionConfig>,
    );
    expect(box.style.transform === '' || box.style.transform === 'none').toBe(true);
    const her = getCharacterHandle()!.el;
    expect(her.style.left).toBe(`${100 + PAD}px`);
    expect(her.style.top).toBe(`${200 + PAD}px`);
  });
});

/**
 * The floating panel and docked ground are separate layers, so at a change of dock she leaves one and
 * arrives at the other on her own beat (`panel.character.pop`), a zoom rather than a fade. The floating
 * panel carries her otherwise.
 */
describe('the character leaves and arrives at a change of form', () => {
  let frames: Keyframe[] | null = null;
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  const POP = {
    total: seconds('panel.character.pop'),
    easing: 'ease-out',
    land: 'ease-in-out',
    from: 1 - (amplitude('panel.character.pop') ?? 0),
    past: overshootAt('panel.character.pop'),
  };

  beforeEach(() => {
    frames = null;
    (Element.prototype as any).animate = (k: Keyframe[]) => {
      frames = k;
      return { cancel: () => {}, finish: () => {}, playState: 'running' };
    };
    render(
      <MotionConfig reducedMotion="always">
        <Character pose="idle" size={64} />
      </MotionConfig>,
    );
  });
  afterEach(() => {
    cleanup();
    (Element.prototype as any).animate = realAnimate;
  });

  /** Arriving from invisible needs a painted start frame; the destination is written on the element,
   *  so no fill is needed. */
  it('names both ends and writes the destination itself', () => {
    popCharacter(0, POP);
    expect(frames?.[0]).toEqual({ opacity: 1, transform: 'scale(1)', easing: POP.easing });
    expect(frames?.[frames.length - 1]).toEqual({ opacity: 0, transform: `scale(${POP.from})` });
    expect(getCharacterHandle()?.el.style.opacity).toBe('0');

    popCharacter(1, POP);
    expect(frames?.[0]).toEqual({ opacity: 0, transform: `scale(${POP.from})`, easing: POP.easing });
    expect(frames?.[frames.length - 1]).toEqual({ opacity: 1, transform: 'scale(1)' });
    expect(getCharacterHandle()?.el.style.opacity).toBe('1');
    expect(getCharacterHandle()?.el.style.transform).toBe('none');
  });

  /** The overshoot sits past half way, or the settle would last as long as the approach. */
  it('overshoots on the way in and never on the way out', () => {
    popCharacter(1, POP);
    const middle = frames?.[1] as { transform: string; offset: number; easing: string };
    expect(parseFloat(/scale\(([\d.]+)\)/.exec(middle.transform)?.[1] ?? '0')).toBeGreaterThan(1);
    expect(middle.offset).toBe(POP.past);
    expect(POP.past).toBeGreaterThan(0.5);
    expect(middle.easing).toBe(POP.land);

    popCharacter(0, POP);
    expect(frames).toHaveLength(2);
    for (const f of frames ?? []) {
      const scale = /scale\(([\d.]+)\)/.exec(String((f as { transform?: string }).transform));
      if (scale) expect(parseFloat(scale[1] ?? '0')).toBeLessThanOrEqual(1);
    }
  });

  /** The dock swaps forms over the floating exit's beat, so a longer departure would be cut off. */
  it('leaves in the time the form leaving has, and arrives in longer', () => {
    expect(outSeconds('panel.character.pop')).toBeCloseTo(seconds('panel.close'), 6);
    expect(seconds('panel.character.pop')).toBeGreaterThan(outSeconds('panel.character.pop'));
  });

  /** Under a full-window sheet or reduced motion the beat is not played. */
  it('writes her presence outright where there is no beat to play', () => {
    popCharacter(0, POP);
    frames = null;
    showCharacter(1);
    expect(getCharacterHandle()?.el.style.opacity).toBe('1');
    expect(getCharacterHandle()?.el.style.transform).toBe('none');
    expect(frames).toBeNull();
  });

  it('scales her about the ground she stands on', () => {
    popCharacter(1, POP);
    expect(getCharacterHandle()?.el.style.transformOrigin).toBe('50% 100%');
  });

});

/** Pinning an open floating panel lands the form on the dock ground, and the host pops her there. */
describe('the host pops her on the declared beat at a change of form', () => {
  let played: KeyframeAnimationOptions[] = [];
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  beforeEach(() => {
    played = [];
    (Element.prototype as any).animate = function (this: Element, _k: Keyframe[], o: KeyframeAnimationOptions) {
      if (this === getCharacterHandle()?.el) played.push(o);
      return { cancel: () => {}, finish: () => {}, playState: 'running' };
    };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    useEditorStore.setState({ assistantPinned: false, assistantOpen: true, uiZoom: 1 });
  });
  afterEach(() => {
    cleanup();
    setCarry(1, { left: 0, top: 0, scale: 1 });
    useEditorStore.setState({ assistantPinned: false, assistantOpen: false });
    (Element.prototype as any).animate = realAnimate;
  });

  it('runs her arrival on its own declared length', () => {
    const entrance = document.createElement('div');
    stubRect(entrance, 78, 188, SEAT);
    render(
      <MotionConfig reducedMotion="never">
        <I18nProvider>
          <CharacterHost entranceRef={{ current: entrance }} open connected size={60} />
        </I18nProvider>
      </MotionConfig>,
    );
    expect(played).toHaveLength(0);
    act(() => { useEditorStore.setState({ assistantPinned: true }); });
    expect(played.map((o) => o.duration)).toEqual([seconds('panel.character.pop') * 1000]);
  });
});
