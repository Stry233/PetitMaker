// @vitest-environment jsdom
/**
 * The dreaming board: each slip stands at its natural height, and the board's outer height is fixed
 * to the tallest trio its rotation can show, in the rows' CSS px (a scale probe divides out the zoom
 * in the ruler's screen-px rects).
 *
 * jsdom has no layout, so `getBoundingClientRect` is stubbed: a row's height follows its text length,
 * times the stub's zoom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { DreamOffice, DREAMS, boardHeight } from '../../../ui/agent/desk/DreamOffice';
import { translations } from '../../_support/locale-tables';
import type { Locale } from '../../../core/model/locale';
import { spec } from '../../_support/spec';

/** A row's stubbed css height: strictly increasing with its text length, so slips of different
 *  length never tie. */
const rowHeightFor = (chars: number) => 40 + Math.max(1, chars) * 2;

/** The stub's zoom on every rect; 1.25 is exact in binary, so css px divide back out exactly. */
const ZOOM = 1.25;

/** The scale probe's css width, `DreamOffice`'s `SCALE_PROBE_W`. */
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

/** Each pool order's natural height in CSS px, read off the hidden ruler stack. */
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

      // The rAF loop reads `performance.now()`, so the fake clock turns it over; a beat is 3800ms.
      const seen = new Set<string>([first.height]);
      for (const _ of [0, 1]) {
        act(() => { vi.advanceTimersByTime(4000); });
        seen.add(board(container).height);
      }
      expect([...seen], 'no rotation changes the board height').toEqual([first.height]);
    });
  }

  /** The rotation shows three consecutive orders of the cycle, so the reserve is the tallest cyclic
   *  window, not three tall slips that never stand together nor the tallest slip times three. */
  it('reserves the tallest trio the rotation can actually show, not the pool\'s three tallest from anywhere', () => {
    // Cyclic windows of three: 201, 102, 201, 201, 201 (the three tallest anywhere sum to 300), plus
    // two 6px row gaps.
    expect(boardHeight([100, 1, 100, 1, 100])).toBe(201 + 12);
  });

  it('reserves exactly what the measured pool\'s tallest window needs, and renders it', () => {
    const { container } = mount();
    const measured = measuredPool(container);
    expect(measured.length, 'every order in the pool is measured').toBeGreaterThan(3);
    expect(board(container).height).toBe(`${boardHeight(measured)}px`);
  });

  /** An unconverted rect would reserve zoom times the room: too tall above 1, clipping below it. */
  it('writes the reserve in the rows\' own css px, not the screen px the rects answer in', () => {
    const { container } = mount();
    const cssPool = measuredPool(container);
    const zoomedPool = cssPool.map((h) => Math.ceil(h * ZOOM));
    expect(board(container).height).toBe(`${boardHeight(cssPool)}px`);
    expect(board(container).height).not.toBe(`${boardHeight(zoomedPool)}px`);
  });

  it('renders two candidates of different natural height at different row heights', () => {
    const { container } = mount();
    const distinct = new Set(board(container).rows.map((h) => Math.round(h)));
    expect(distinct.size, 'the board does not clamp every slip to one shared height').toBeGreaterThan(1);
  });

  /** The clip box carries the hiding, so the stack inside lays out like the rows. */
  it('keeps the ruler out of sight and out of the way', () => {
    const { container } = mount();
    const clip = (container.querySelector('[data-testid="dream-measure"]') as HTMLElement).parentElement!;
    expect(clip.style.position).toBe('absolute');
    expect(clip.style.visibility).toBe('hidden');
    expect(clip.style.pointerEvents).toBe('none');
    expect(clip.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * An absolutely positioned descendant counts toward its scrolling ancestor's overflow whatever its
   * visibility, so the pool-sized ruler stands in a zero-height overflow-hidden box, and the board's
   * own `overflow: hidden` covers the rotation's transient geometry.
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

  /** Docked, the zone is the window's height, so the whole pool stands with no rotation or reserve. */
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

  /** A wrapping title or sub line grows the reserve, so the three longest lines stay under the counts
   *  where they wrap in the live panel (1280x800 at the frame's 1.25 zoom). */
  it('keeps the pool\'s known-tall lines short enough not to wrap, in en and in ru', () => {
    const village = DREAMS.find((o) => o.id === 'village')!;
    const forest = DREAMS.find((o) => o.id === 'forest')!;
    const road = DREAMS.find((o) => o.id === 'road')!;
    // Measured fit boundaries at the panel's column width: the bolder, larger title font and
    // Cyrillic both wrap sooner.
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

/**
 * A row that survives a beat glides up from where it stood. The board sits under the interface's
 * CSS zoom, where rects answer in screen px while the glide's translate runs in the rows' own px,
 * so the stub reports each row's place both ways and the glide must travel exactly one local step.
 */
describe('a surviving row glides one row up', () => {
  const STEP = 60;
  const realAnimate = HTMLElement.prototype.animate;
  const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')!;
  let glides: { order: string | null; from: string | undefined }[] = [];

  /** A standing row's slot on the board, from its place among the standing rows. */
  const slot = (el: HTMLElement): number => [...el.parentElement!.querySelectorAll('[data-testid="dream-row"]')].indexOf(el);

  beforeEach(() => {
    vi.useFakeTimers();
    glides = [];
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) { return this.dataset.testid === 'dream-row' ? slot(this) * STEP : 0; },
    });
    Element.prototype.getBoundingClientRect = function stub(this: Element): DOMRect {
      const top = this instanceof HTMLElement && this.dataset.testid === 'dream-row' ? slot(this) * STEP * ZOOM : 0;
      return { x: 0, y: top, width: 336, height: 0, top, left: 0, right: 336, bottom: top, toJSON: () => ({}) } as DOMRect;
    };
    HTMLElement.prototype.animate = function record(this: HTMLElement, frames: Keyframe[] | PropertyIndexedKeyframes | null) {
      const first = Array.isArray(frames) ? frames[0] : undefined;
      if (this.dataset.testid === 'dream-row') glides.push({ order: this.getAttribute('data-order'), from: first?.transform as string | undefined });
      return { cancel() {}, finished: Promise.resolve() } as unknown as Animation;
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
    HTMLElement.prototype.animate = realAnimate;
    vi.useRealTimers();
  });

  spec('UI-39', 'the keyless board\'s surviving rows glide exactly one row under the interface zoom', () => {
    const { container } = mount();
    const before = [...container.querySelectorAll('[data-testid="dream-row"]')].map((r) => r.getAttribute('data-order'));
    glides = [];
    act(() => { vi.advanceTimersByTime(4000); });
    // The arriving row's entrance also starts translated, but scaled as well.
    const moved = glides.filter((g) => /^translateY\([-\d.]+px\)$/.test(g.from ?? ''));
    expect(moved.map((g) => g.order)).toEqual(before.slice(1));
    for (const g of moved) expect(g.from).toBe(`translateY(${STEP}px)`);
  });
});
