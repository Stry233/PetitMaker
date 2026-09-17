/**
 * TWO SEATS, ONE CHARACTER, AND A STEP BETWEEN THEM.
 *
 * The character is one `fixed` element positioned from a seat's measured rect, so where she stands is
 * a reading rather than a layout — and a reading goes stale. Both seats are placed by the frame, which
 * follows the window and the user's UI zoom, so a placement made once at mount leaves her standing
 * beside her own box after a resize.
 *
 * WHAT OPENING THE PANEL MOVES IS HER, AND ONLY A LITTLE. The panel stands where the frame's grid puts
 * it, and the desk's seat inside it is at the plate's own padding beside the dock card, so her walk
 * from the folded box to that seat is bounded by her own size and runs on a declared motion.
 *
 * jsdom lays nothing out, so a seat's rect is stubbed and what is asserted is the inline
 * `left`/`top`/`transition` the placement writes from it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { DeskHeader } from '../../../ui/agent/DeskHeader';
import { Character, getCharacterHandle } from '../../../ui/agent/character/Character';
import { CharacterHost } from '../../../ui/agent/character/CharacterHost';
import {
  carriedAlong, carryStep, parkCharacter, placeCarried, popCharacter, restingSeat, seatBox, setCarry,
  setDeskSeat, setPanelCarriage, showCharacter,
} from '../../../ui/agent/character/seat';
import { useEditorStore } from '../../../state/store';
import { amplitude, outSeconds, overshootAt, seconds } from '../../../ui/agent/motion';
import {
  CHARACTER_SEAT, PANEL_LEFT, PANEL_PLATE_PAD, PANEL_TOP, panelTop, SEAT_TRAVEL_MAX,
} from '../../../ui/shell/panel-frame';
import { MODE_ROW_BASE, MODE_ROW_INK_BOTTOM } from '../../../ui/shell/frame';
import { EDGE_LEFT, LABEL_BOX_DEPTH, MODE } from '../../../ui/shell/units';
import { JOB_ZONE_FLOOR, PINNED_HEIGHT } from '../../../ui/agent/PanelShell';
import { frameZoom, resolveCss } from '../shell/_resolve-css';
import { poseLegacyZoom } from '../_legacy-zoom';

/** How far inside the seat she stands, at the box's own declared size. */
const PAD = CHARACTER_SEAT.pad;
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

/** The host every mount here stands: her seat as an empty box, and the one live Character beside it
 *  in a layer of its own, exactly as `CharacterHost` mounts the pair. */
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

/** The desk at rest, which is all the rendered seat assertion needs: reduced motion keeps the card's
 *  flip and the character's own WAAPI calls (which jsdom has no engine for) out of the way. */
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
    // jsdom has no Web Animations API; the placement is what is under test, not the choreography.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
  });
  afterEach(() => {
    cleanup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  /** THE PAD RIDES THE BOX. The seat is declared in the frame's own px and measured in the window's,
   *  which differ by the frame's zoom, so a pad written raw would stand her off-centre at any zoom
   *  but one. */
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
 * THE SEAT IS RE-READ AFTER THE ROOM FINISHES MOVING, and a resize's own dispatch is too early.
 *
 * The frame's zoom is React state flushed in batches BETWEEN the window's resize listeners, so a
 * placement made during the dispatch — a listener's own, or one in the flush's re-render — measures
 * the seat where the PREVIOUS layout put it. The contract is therefore about the frame AFTER the
 * event: whatever any listener saw, she wears the placement of the layout the resize produced, with
 * no interaction.
 */
describe('the seat survives a window resize', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = () => ({ cancel: () => {}, finish: () => {}, playState: 'idle' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  });
  afterEach(() => {
    cleanup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // The window narrows. Every listener that runs in this dispatch still measures the old layout:
    // the box only moves when the frame re-renders at its new fit, after the event.
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1040 });
      window.dispatchEvent(new Event('resize'));
    });
    stubRect(entrance, 71, 135, SEAT);

    // One frame later, with nothing pressed, she sits where the new layout put her seat.
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
 * THE PANEL STANDS ON THE FRAME'S GRID, AND SHE IS THE ONE WHO MOVES.
 *
 * Two facts hold the alignment together and neither is the other's consequence: the column's own edges
 * are the frame's (the block rows' left margin, the mode row's clearance), and the desk's seat inside
 * it is at the plate's padding beside the dock card. What is left over is her walk between the folded
 * box and that seat, and what is asserted about it is that it stays inside her own size.
 */
describe('the panel stands on the grid and she steps to the desk', () => {
  /** The panel's own least height, as `PanelColumn` derives it — from the same two constants rather
   *  than typed, so a taller dock moves this with it. */
  const LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;

  /** Where the desk's seat lands at a window, in frame px: the column's top edge wherever the clamp
   *  put it, plus the plate's padding the desk stands inside, on both axes. */
  const deskSeatAt = (w: number, h: number, ui: number) => ({
    left: PANEL_LEFT + PANEL_PLATE_PAD,
    top: resolveCss(panelTop(LEAST), h, frameZoom(w, h, ui)) + PANEL_PLATE_PAD,
  });

  /**
   * THE COLUMN'S EDGES ARE THE FRAME'S OWN, which is the whole of the alignment: the left margin the
   * two block rows keep, and the row clearance below the mode row's caption. Nothing about the
   * character enters either number, so her box moving cannot move the panel.
   *
   * THE TOP CLEARS THE CAPTION'S BOX, not its modelled ink, which is where it parts from the
   * character's row beside it: a plate edge inside a caption's line box reads as touching the word.
   */
  it('takes both its edges from the frame\'s grid', () => {
    expect(PANEL_LEFT).toBe(EDGE_LEFT);
    const captionBox = MODE_ROW_BASE + MODE.label.gap + LABEL_BOX_DEPTH * MODE.label.size;
    expect(PANEL_TOP).toBeCloseTo(captionBox + MODE.rowClearance, 6);
    // Strictly below the row spacing the character hangs from, and by the slack the caption's box
    // holds under its glyphs.
    expect(PANEL_TOP).toBeGreaterThan(MODE_ROW_INK_BOTTOM + MODE.rowClearance);
    expect(resolveCss(panelTop(LEAST), 800, frameZoom(1280, 800, 1))).toBeCloseTo(PANEL_TOP, 6);
  });

  /** AND IT CLEARS THE CAPTION BY THE CLEARANCE IT DECLARES, measured to the box the browser
   *  actually reserves for the word rather than to the glyphs inside it. */
  it('leaves the mode row\'s caption its own box, whole', () => {
    const captionBox = MODE_ROW_BASE + MODE.label.gap + LABEL_BOX_DEPTH * MODE.label.size;
    expect(captionBox).toBeGreaterThan(MODE_ROW_INK_BOTTOM);
    expect(PANEL_TOP - captionBox).toBeCloseTo(MODE.rowClearance, 6);
  });

  /** THE SEAT CARRIES NO OFFSET OF ITS OWN. The desk's row is top-aligned, so an empty box with no
   *  margins stands on the dock card's own top edge, which is what being aligned with the dock is. */
  it('reserves the seat flush with the dock card, with no offset of its own', () => {
    const view = renderDesk();
    const slot = view.getByTestId('desk-header-char-slot');
    expect(slot.style.marginTop).toBe('');
    expect(slot.style.marginLeft).toBe('');
    expect(view.getByTestId('desk-header').style.alignItems).toBe('flex-start');
  });

  /**
   * THE FOLD'S TRAVEL IS BOUNDED BY HER OWN BOX, at every window the frame is judged in and every zoom
   * the preference reaches. The column's top yields to a short window at a large UI zoom while her
   * folded box does not, so the distance is not a constant — what makes the collapse read as one form
   * gathering onto her button rather than a card flying across the frame is that it never grows past
   * her.
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

  /** AND THE DESK SEAT IS DOWN AND TO THE RIGHT of her folded box at the frame's own reference window,
   *  which is the direction the design asks for: the desk beside the card stands below and inside the
   *  block she was pressed in. */
  it('puts the desk seat down and to the right of her folded box', () => {
    const seat = deskSeatAt(1280, 800, 1);
    expect(seat.left).toBeGreaterThan(CHARACTER_SEAT.left);
    expect(seat.top).toBeGreaterThan(CHARACTER_SEAT.top);
  });
});

/**
 * THE FLOATING PANEL AND THE CHARACTER ARE ONE OBJECT, AND HERE THAT IS ARITHMETIC RATHER THAN A CLAIM.
 *
 * One number says how far the collapse still has to travel; the carriage takes it as a transform and she
 * is placed at her seat plus the same remainder, in the same call. So her offset INSIDE the panel is the
 * difference of the two seats at every value that number can take — which is what two animations of the
 * same length on the same curve do not give, one running on the compositor and one through layout.
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

  /** THE ONE INVARIANT, sampled the whole way along: if the two halves were ever written from different
   *  numbers this is what would drift. */
  it('holds her offset inside the panel at every point of the gesture', () => {
    render(<Character pose="idle" size={40} />);
    const box = carriage();
    const step = carryStep(SEAT, FOLDED);
    const her = getCharacterHandle()!.el;
    for (let n = 0; n <= 20; n += 1) {
      placeCarried(SEAT, step, n / 20);
      const shift = shiftOf(box);
      expect(parseFloat(her.style.left) - shift.x * step.scale).toBeCloseTo(SEAT.left, 6);
      expect(parseFloat(her.style.top) - shift.y * step.scale).toBeCloseTo(SEAT.top, 6);
    }
  });

  /** BOTH ENDS ARE THE PLACES THE TWO FORMS ACTUALLY STAND: at rest the carriage takes no transform at
   *  all, and folded her seat lands exactly on the box the press was made in. */
  it('lands the panel at rest and her seat on her button at the two ends', () => {
    render(<Character pose="idle" size={40} />);
    const box = carriage();
    const step = carryStep(SEAT, FOLDED);
    const her = getCharacterHandle()!.el;

    placeCarried(SEAT, step, 1);
    expect(box.style.transform).toBe('none');
    expect(her.style.left).toBe(`${SEAT.left}px`);

    placeCarried(SEAT, step, 0);
    expect(shiftOf(box).x).toBeCloseTo(step.left, 6);
    expect(parseFloat(her.style.left)).toBeCloseTo(FOLDED.left, 6);
    expect(parseFloat(her.style.top)).toBeCloseTo(FOLDED.top, 6);
  });

  /** A TRANSLATE AND NOTHING ELSE. A scale on the carriage would change the seat's measured rect while
   *  the travel was being read off it, and the desk's seat is inside the carriage. */
  it('never scales the carriage', () => {
    const box = carriage();
    const step = carryStep(SEAT, FOLDED);
    for (let n = 0; n <= 4; n += 1) {
      placeCarried(SEAT, step, n / 4);
      expect(box.style.transform).not.toContain('scale');
    }
  });

  /**
   * THE SEAT IS READ WITH THE COLLAPSE TAKEN BACK OUT OF IT, because the desk's slot travels inside the
   * carriage. Read raw while it was travelling, the distance left shortened every frame and the panel
   * folded a diminishing series that stopped half way, with the character walking the whole of it.
   */
  it('takes the carriage\'s own displacement back out of a seat inside it', () => {
    const step = carryStep(SEAT, FOLDED);
    placeCarried(SEAT, step, 0);
    // Fully folded, the slot's measured rect IS her folded box, and the seat behind it is the resting one.
    const rest = restingSeat({ ...SEAT, left: FOLDED.left, top: FOLDED.top })!;
    expect(rest.left).toBeCloseTo(SEAT.left, 6);
    expect(rest.top).toBeCloseTo(SEAT.top, 6);
  });

  /** The number is remembered, so a re-placement between gestures puts both halves back where the last
   *  frame left them rather than at an end. */
  it('remembers how far along the gesture is', () => {
    setCarry(0.4, carryStep(SEAT, FOLDED));
    expect(carriedAlong()).toBe(0.4);
  });

  /** Silent with no carriage registered: a headless mount has no panel for the gesture to carry. */
  it('places her alone where no carriage has been handed in', () => {
    render(<Character pose="idle" size={40} />);
    setPanelCarriage(null);
    placeCarried(SEAT, carryStep(SEAT, FOLDED), 1);
    expect(getCharacterHandle()!.el.style.left).toBe(`${SEAT.left}px`);
  });
});

/**
 * THE DOCKED GROUND TAKES NO GESTURE TRAVEL. The fold's displacement belongs to the FLOATING form;
 * docked, the sheet is the whole motion and the fraction is simply home — whatever the panel's own
 * open intent says. A collapse pressed over a docked panel reads as open=false with the stage still
 * at the ground, and handing the carriage the fold's travel there teleported the window-tall ground
 * its full step on the press (measured live: 472 x 119 px, at full opacity).
 */
describe('the docked ground takes no gesture travel', () => {
  const realAnimate = (Element.prototype as unknown as { animate?: unknown }).animate;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // She goes down with the desk she is sitting at, covered by the returning sheet.
    const her = getCharacterHandle()!.el;
    expect(her.style.left).toBe(`${100 + PAD}px`);
    expect(her.style.top).toBe(`${200 + PAD}px`);
  });
});

/**
 * SHE LEAVES AND ARRIVES AT A CHANGE OF FORM, AND ONLY THERE.
 *
 * The floating panel and the docked ground are different layers and neither pretends to be the other, so
 * a change of dock is not a crossing she makes: she goes from the form being replaced and comes to the
 * one replacing it, on a beat of her own. Free there is no beat at all — the panel carries her.
 *
 * A ZOOM WITH WEIGHT IN IT RATHER THAN A FADE (`panel.character.pop`): the arrival passes her own size
 * and comes back to it, the departure goes straight down and out.
 */
describe('the character leaves and arrives at a change of form', () => {
  let frames: Keyframe[] | null = null;
  let options: KeyframeAnimationOptions | null = null;
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
    options = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = (k: Keyframe[], o: KeyframeAnimationOptions) => {
      frames = k;
      options = o;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = realAnimate;
  });

  /** BOTH ENDS ARE NAMED, because coming back she is arriving from invisible and a transition needs a
   *  painted frame at the old value to interpolate from. The destination is on the element from the same
   *  frame, so the animation needs no fill. */
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

  /** THE ARRIVAL PASSES HER OWN SIZE AND THE DEPARTURE DOES NOT: the overshoot is what says the arrival
   *  is staying, and one on the way out would say she was about to come back. It sits where the entry
   *  puts it rather than half way, or the settle gets as long as the whole approach. */
  it('overshoots on the way in and never on the way out', () => {
    popCharacter(1, POP);
    const middle = frames?.[1] as { transform: string; offset: number; easing: string };
    expect(parseFloat(/scale\(([\d.]+)\)/.exec(middle.transform)?.[1] ?? '0')).toBeGreaterThan(1);
    expect(middle.offset).toBe(POP.past);
    expect(POP.past).toBeGreaterThan(0.5);
    // THE SETTLE HAS ITS OWN SHAPE, on the keyframe the interval starts at.
    expect(middle.easing).toBe(POP.land);

    popCharacter(0, POP);
    expect(frames).toHaveLength(2);
    for (const f of frames ?? []) {
      const scale = /scale\(([\d.]+)\)/.exec(String((f as { transform?: string }).transform));
      if (scale) expect(parseFloat(scale[1] ?? '0')).toBeLessThanOrEqual(1);
    }
  });

  /** THE LEAVE IS THE LENGTH OF THE FORM'S OWN. The dock hands one form to the other over the floating
   *  exit's beat, so a departure of hers that ran longer would be cut off part-played by the arrival. */
  it('leaves in the time the form leaving has, and arrives in longer', () => {
    expect(outSeconds('panel.character.pop')).toBeCloseTo(seconds('panel.close'), 6);
    expect(seconds('panel.character.pop')).toBeGreaterThan(outSeconds('panel.character.pop'));
  });

  /** THE BEAT NOBODY CAN SEE IS NOT PLAYED: under a sheet covering the whole window, and under reduced
   *  motion, her presence is simply written. */
  it('writes her presence outright where there is no beat to play', () => {
    popCharacter(0, POP);
    frames = null;
    showCharacter(1);
    expect(getCharacterHandle()?.el.style.opacity).toBe('1');
    expect(getCharacterHandle()?.el.style.transform).toBe('none');
    expect(frames).toBeNull();
  });

  /** The scale grows about her FEET, so a character popping in stands on the desk rather than drifting
   *  up out of it. */
  it('scales her about the ground she stands on', () => {
    popCharacter(1, POP);
    expect(getCharacterHandle()?.el.style.transformOrigin).toBe('50% 100%');
  });

  it('runs on its own declared length', () => {
    popCharacter(1, POP);
    expect(options?.duration).toBe(seconds('panel.character.pop') * 1000);
  });
});
