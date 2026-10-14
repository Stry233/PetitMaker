// @vitest-environment jsdom
/**
 * The board reserves the tallest trio its own rotation can ever show, not a uniform per-row clamp
 * and not three tall slips that never stand together. Slips wrap per order and per locale, so each
 * stands at its natural height and only the board's outer height is fixed, to the tallest window of
 * consecutive shown orders; a lighter trio leaves empty room under the rows.
 *
 * The reserve is in the rows' own CSS px. The ruler's rects are screen px (the frame's and the UI's
 * zoom multiply into `getBoundingClientRect`), so a scale probe beside the stack divides them out.
 *
 * jsdom has no layout: `getBoundingClientRect` is stubbed to answer a row's height from its text
 * length times the probe's zoom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { DreamOffice, DREAMS, boardHeight } from '../../../ui/agent/desk/DreamOffice';
import { translations } from '../../_support/locale-tables';
import type { Locale } from '../../../core/model/locale';

/** How tall a row of `n` characters stands, in css px in the stub: strictly increasing with the text
 *  it holds, so two slips of different length never tie by coincidence. The numbers matter only in
 *  that they differ per slip. */
const rowHeightFor = (chars: number) => 40 + Math.max(1, chars) * 2;

/** The stub's own zoom: every rect answers in screen px, `rowHeightFor`'s css times this. A quarter,
 *  so css px divide back out of the floats exactly. */
const ZOOM = 1.25;

/** The scale probe's declared css width (`DreamOffice`'s own constant, pinned where it is read). */
const SCALE_PROBE_W = 96;

const realRect = Element.prototype.getBoundingClientRect;

function stubLayout(): void {
  Element.prototype.getBoundingClientRect = function stub(this: Element): DOMRect {
    if (this instanceof HTMLElement && this.dataset.testid === 'dream-measure-scale') {
      const w = SCALE_PROBE_W * ZOOM;
      return { x: 0, y: 0, width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, toJSON: () => ({}) } as DOMRect;
    }
    const isRow = this instanceof HTMLElement
      && (this.dataset.testid === 'dream-row' || this.dataset.testid === 'dream-row-leaving'
        || this.parentElement?.getAttribute('data-testid') === 'dream-measure');
    if (!isRow) return { x: 0, y: 0, width: 336, height: 0, top: 0, left: 0, right: 336, bottom: 0, toJSON: () => ({}) } as DOMRect;
    const h = rowHeightFor((this.textContent ?? '').length) * ZOOM;
    return { x: 0, y: 0, width: 336, height: h, top: 0, left: 0, right: 336, bottom: h, toJSON: () => ({}) } as DOMRect;
  };
}

/** Mounted inside `act`, because the board's own rAF loop commits a beat on the first frame. */
function mount(pinned = false): { container: HTMLElement } {
  let out!: { container: HTMLElement };
  act(() => { out = render(<I18nProvider><DreamOffice onConnect={() => {}} pinned={pinned} /></I18nProvider>); });
  return out;
}

/** The board's own reserved height, and the natural height each standing row rendered at. */
function board(container: HTMLElement): { height: string; rows: number[] } {
  const rows = container.querySelector('[data-testid="dream-rows"]') as HTMLElement;
  return {
    height: rows.style.height,
    rows: [...container.querySelectorAll('[data-testid="dream-row"]')]
      .map((r) => (r as HTMLElement).getBoundingClientRect().height),
  };
}

/** Every order in the pool's own natural height in CSS px, read off the hidden ruler stack: the
 *  stubbed rects answer in screen px, so the stub's own zoom divides back out. */
function measuredPool(container: HTMLElement): number[] {
  return [...container.querySelectorAll('[data-testid="dream-measure"] > *')]
    .map((r) => (r as HTMLElement).getBoundingClientRect().height / ZOOM);
}

describe('every slip carries its own built picture', () => {
  it('renders a thumbnail image on each visible row, never an empty box', () => {
    const { container } = mount();
    const thumbs = container.querySelectorAll('[data-testid="dream-thumb"]');
    expect(thumbs.length).toBeGreaterThan(0);
    for (const img of thumbs) {
      expect((img as HTMLImageElement).getAttribute('src'), 'thumb src').toBeTruthy();
    }
  });
});

describe('the dreaming board reserves one height', () => {
  beforeEach(() => {
    stubLayout();
    vi.useFakeTimers();
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
    vi.useRealTimers();
    act(() => { useEditorStore.setState({ locale: 'en' }); });
  });

  for (const locale of ['en', 'ru', 'th'] as Locale[]) {
    it(`holds its height across two rotations in ${locale}`, () => {
      act(() => { useEditorStore.setState({ locale }); });
      const { container } = mount();
      const expected = boardHeight(measuredPool(container));
      expect(expected, 'the pool is measured').toBeGreaterThan(0);

      const first = board(container);
      expect(first.height, 'the board reserves a height at mount').toBe(`${expected}px`);

      // Two rotations. The board is driven by a rAF loop off `performance.now()`, so the clock is
      // what turns it over; the beat is 3800ms.
      const seen = new Set<string>([first.height]);
      for (const _ of [0, 1]) {
        act(() => { vi.advanceTimersByTime(4000); });
        seen.add(board(container).height);
      }
      expect([...seen], 'no rotation changes the board height').toEqual([first.height]);
    });
  }

  /** The rotation shows shown consecutive orders of the cycle, so the tallest trio it can ever show
   *  is the tallest cyclic window — not the pool's three tallest from anywhere (three tall slips that
   *  never stand together buy room no real trio uses) and not the tallest slip repeated shown times
   *  (a uniform clamp, which overshoots the same way). */
  it('reserves the tallest trio the rotation can actually show, not the pool\'s three tallest from anywhere', () => {
    // Cyclic windows of three: 201, 102, 201, 201, 201. The three tallest from anywhere sum to 300.
    expect(boardHeight([100, 1, 100, 1, 100])).toBe(201 + 12);
  });

  it('reserves exactly what the measured pool\'s tallest window needs, and renders it', () => {
    const { container } = mount();
    const measured = measuredPool(container);
    expect(measured.length, 'every order in the pool is measured').toBeGreaterThan(3);
    expect(board(container).height).toBe(`${boardHeight(measured)}px`);
  });

  /** The rects the ruler reads carry the frame's zoom; the reserve is a css height inside it. A rect
   *  written back unconverted reserves zoom-times the room: too tall above 1, clipping below 1. */
  it('writes the reserve in the rows\' own css px, not the screen px the rects answer in', () => {
    const { container } = mount();
    const cssPool = measuredPool(container);
    const zoomedPool = cssPool.map((h) => Math.ceil(h * ZOOM));
    expect(board(container).height).toBe(`${boardHeight(cssPool)}px`);
    expect(board(container).height).not.toBe(`${boardHeight(zoomedPool)}px`);
  });

  /** No shared box: two candidates whose own text differs in length stand at two different heights. */
  it('renders two candidates of different natural height at different row heights', () => {
    const { container } = mount();
    const distinct = new Set(board(container).rows.map((h) => Math.round(h)));
    expect(distinct.size, 'the board does not clamp every slip to one shared height').toBeGreaterThan(1);
  });

  /** The measuring stack is out of the flow and out of the reading order: it is a ruler. Its clip
   *  box is what carries the hiding, so the stack inside stays plain flow the rows share. */
  it('keeps the ruler out of sight and out of the way', () => {
    const { container } = mount();
    const clip = (container.querySelector('[data-testid="dream-measure"]') as HTMLElement).parentElement!;
    expect(clip.style.position).toBe('absolute');
    expect(clip.style.visibility).toBe('hidden');
    expect(clip.style.pointerEvents).toBe('none');
    expect(clip.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * The ruler cannot reach the board's scrollable overflow. The stack sizes itself to the whole pool,
   * and an absolutely positioned descendant counts toward its scrolling ancestor's overflow whatever
   * its visibility. So the ruler stands in its own zero-height overflow-hidden box, and the board's
   * own `overflow: hidden` backs that up over the rotation's transient geometry.
   */
  it('contains the ruler in a box the board\'s scrollable overflow cannot see', () => {
    const { container } = mount();
    const clip = (container.querySelector('[data-testid="dream-measure"]') as HTMLElement).parentElement!;
    expect(clip.style.height).toBe('0px');
    expect(clip.style.overflow).toBe('hidden');
    const rows = container.querySelector('[data-testid="dream-rows"]') as HTMLElement;
    expect(rows.style.overflow).toBe('hidden');
    expect(rows.contains(clip), 'the ruler still lays out at the rows\' own width').toBe(true);
  });

  /**
   * Docked, the board takes the room that exists: the zone is the window tall, so a three-row window
   * over a five-order pool showed three slips against hundreds of px of empty cream. The whole pool
   * stands, at its own natural height — no rotation window, so no reserve and no ruler either.
   */
  describe('docked, the board stands the whole pool', () => {
    it('shows every order in the pool, standing', () => {
      const { container } = mount(true);
      expect(container.querySelectorAll('[data-testid="dream-row"]')).toHaveLength(DREAMS.length);
    });

    it('reserves no fixed height and mounts no ruler', () => {
      const { container } = mount(true);
      const rows = container.querySelector('[data-testid="dream-rows"]') as HTMLElement;
      expect(rows.style.height).toBe('');
      expect(container.querySelector('[data-testid="dream-measure"]')).toBeNull();
    });

    it('turns nothing over: the standing pool has nothing left to reveal', () => {
      const { container } = mount(true);
      const order = () => [...container.querySelectorAll('[data-testid="dream-row"]')]
        .map((r) => r.getAttribute('data-order'));
      const first = order();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(order()).toEqual(first);
      expect(container.querySelector('[data-testid="dream-row-leaving"]')).toBeNull();
    });
  });

  /**
   * A title or sub line long enough to wrap grows the reserve: in the live panel at 1280x800 and
   * the frame's 1.25 zoom such a line wraps at 39-43 chars in en and 33-38 in ru. At the lengths
   * below none of the three longest lines wraps in either locale.
   */
  it('keeps the pool\'s known-tall lines short enough not to wrap, in en and in ru', () => {
    const village = DREAMS.find((o) => o.id === 'village')!;
    const forest = DREAMS.find((o) => o.id === 'forest')!;
    const road = DREAMS.find((o) => o.id === 'road')!;
    // The title role font wraps at a shorter count than the sub role font (bolder, larger), and
    // Cyrillic wraps sooner than Latin at either role: all four numbers are the live-measured fit
    // boundary for that role in that locale, at the panel's own column width.
    const titleCap: Record<'en' | 'ru', number> = { en: 34, ru: 28 };
    const subCap: Record<'en' | 'ru', number> = { en: 37, ru: 33 };
    for (const locale of ['en', 'ru'] as const) {
      expect(translations[locale][village.subKey]!.length, `${locale} village sub`).toBeLessThanOrEqual(subCap[locale]);
      expect(translations[locale][forest.subKey]!.length, `${locale} forest sub`).toBeLessThanOrEqual(subCap[locale]);
      expect(translations[locale][road.titleKey]!.length, `${locale} road title`).toBeLessThanOrEqual(titleCap[locale]);
    }
  });
});

describe('the keyless office points at Help', () => {
  it('opens the setup page at its key steps from Learn more', () => {
    useEditorStore.getState().setHelpTarget(null);
    const { container } = mount();
    fireEvent.click(within(container).getByRole('button', { name: translations.en['agent.learn_more'] }));
    expect(useEditorStore.getState().helpTarget).toEqual({ page: 'agent-setup', anchor: 'agsetup-keys' });
    expect(useEditorStore.getState().modals.help).toBe(true);
  });
});
