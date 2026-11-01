// @vitest-environment jsdom
/**
 * The upright object panel turning its cards between the grid and the one sideways row (UI-28), on a
 * rendered shell. jsdom lays nothing out, so the cards stand on a declared geometry, three columns in
 * the grid and one line centred in the box in the row, that gives the morph a distance and the handle
 * a turning height; where the cards and the panel land is checked in a browser.
 */
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { installWebAnimations, type RecordedAnimation } from '../../_support/web-animations';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { Shell } from '../../../ui/shell/Shell';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { __resetUprightGrid } from '../../../ui/shell/bars/objects/UprightObjectPanel';
import { MORPH_ANIMATION, MORPH_PIECE_ATTR, MORPHING_ATTR } from '../../../ui/primitives/morph';
import { UPRIGHT_GRID } from '../../../ui/shell/bars/objects/object-shelf';
import { TEXT } from '../../../ui/shell/units';
import { BAR_LINE_HEIGHT } from '../../../ui/shell/bars/bar-atoms';
import { SEAM_HANDLE } from '../../../ui/primitives/SeamHandle';
import { TOUCH_TARGET } from '../../../ui/design/scale';

vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

const GRID_TOP = 400;
const VIEW_W = 390;
const CARD = { w: 200, h: 300, gap: 8 };
const COLUMNS = 3;

const isGrid = (el: Element): el is HTMLElement => el instanceof HTMLElement && el.dataset.testid === 'shell-shelf-grid';
const cellsOf = (grid: HTMLElement) => Array.from(grid.querySelectorAll<HTMLElement>(`:scope > [${MORPH_PIECE_ATTR}]`));
const heightOf = (grid: HTMLElement) => parseFloat(grid.style.height) || 0;
const scrolls = new WeakMap<HTMLElement, { left: number; top: number }>();
const scrollOf = (grid: HTMLElement) => {
  let at = scrolls.get(grid);
  if (!at) { at = { left: 0, top: 0 }; scrolls.set(grid, at); }
  return at;
};

/** A card's place in its grid's own px, unscrolled. */
function slot(cell: HTMLElement): { left: number; top: number } | null {
  const grid = cell.parentElement;
  if (!grid || !isGrid(grid) || !cell.hasAttribute(MORPH_PIECE_ATTR)) return null;
  const i = cellsOf(grid).indexOf(cell);
  return grid.dataset.arrangement === 'row'
    ? { left: i * (CARD.w + CARD.gap), top: (heightOf(grid) - CARD.h) / 2 }
    : { left: (i % COLUMNS) * (CARD.w + CARD.gap), top: Math.floor(i / COLUMNS) * (CARD.h + CARD.gap) };
}

/** Screen px per px of `el`'s own: the frame draws the panel under a CSS zoom. */
function zoomOf(el: Element): number {
  let zoom = 1;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const own = parseFloat(getComputedStyle(node).zoom);
    if (own > 0) zoom *= own;
  }
  return zoom;
}

/** Where `el` stands on screen with no animation on it, or null for an element off the geometry. */
function placed(el: Element): DOMRect | null {
  const box = (left: number, top: number, width: number, height: number) =>
    ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;
  if (isGrid(el)) return box(0, GRID_TOP, VIEW_W, heightOf(el));
  if (!(el instanceof HTMLElement)) return null;
  const at = slot(el);
  if (!at) return null;
  const { left, top } = scrollOf(el.parentElement!);
  const z = zoomOf(el);
  return box((at.left - left) * z, GRID_TOP + (at.top - top) * z, CARD.w * z, CARD.h * z);
}

let env: ReturnType<typeof installWebAnimations>;

/** Lays out the grid and its cards, each moved by the additive translation it wears, as the browser draws it. */
function layOut(): void {
  env = installWebAnimations('[data-none]');
  const rect = Element.prototype.getBoundingClientRect as unknown as { mockImplementation(f: (this: Element) => DOMRect): void };
  const blank = { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  rect.mockImplementation(function (this: Element) {
    const box = placed(this);
    if (!box) return blank;
    let { left, top } = box;
    for (const a of env.animations) {
      const live = a.animation.playState === 'paused' || a.animation.playState === 'running';
      if (a.target !== this || !live || a.options.composite !== 'add') continue;
      const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(String(a.keyframes[0]?.transform ?? ''));
      if (m) { left += Number(m[1]) * zoomOf(this); top += Number(m[2]) * zoomOf(this); }
    }
    return { ...box, x: left, y: top, left, top, right: left + box.width, bottom: top + box.height };
  });
  const own = (name: string) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) ?? Object.getOwnPropertyDescriptor(Element.prototype, name);
  const define = (name: string, read: (el: HTMLElement) => number | null, write?: (el: HTMLElement, v: number) => boolean) => {
    const real = own(name);
    const mine = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) { return read(this) ?? real?.get?.call(this); },
      set(this: HTMLElement, v: number) { if (!write?.(this, v)) real?.set?.call(this, v); },
    });
    restores.push(() => {
      if (mine) Object.defineProperty(HTMLElement.prototype, name, mine);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    });
  };
  const extent = (grid: HTMLElement) => {
    const n = cellsOf(grid).length;
    return grid.dataset.arrangement === 'row'
      ? { w: n * (CARD.w + CARD.gap) - CARD.gap, h: heightOf(grid) }
      : { w: VIEW_W, h: Math.ceil(n / COLUMNS) * (CARD.h + CARD.gap) - CARD.gap };
  };
  define('offsetLeft', (el) => slot(el)?.left ?? null);
  define('offsetTop', (el) => slot(el)?.top ?? null);
  define('offsetWidth', (el) => (slot(el) ? CARD.w : null));
  define('offsetHeight', (el) => (slot(el) ? CARD.h : null));
  define('clientWidth', (el) => (isGrid(el) ? VIEW_W : null));
  define('clientHeight', (el) => (isGrid(el) ? heightOf(el) : null));
  define('scrollWidth', (el) => (isGrid(el) ? extent(el).w : null));
  define('scrollHeight', (el) => (isGrid(el) ? extent(el).h : null));
  const clampTo = (el: HTMLElement, axis: 'w' | 'h', v: number) => Math.max(0, Math.min(v, extent(el)[axis] - (axis === 'w' ? VIEW_W : heightOf(el))));
  define('scrollLeft', (el) => (isGrid(el) ? scrollOf(el).left : null), (el, v) => (isGrid(el) ? ((scrollOf(el).left = clampTo(el, 'w', v)), true) : false));
  define('scrollTop', (el) => (isGrid(el) ? scrollOf(el).top : null), (el, v) => (isGrid(el) ? ((scrollOf(el).top = clampTo(el, 'h', v)), true) : false));
}
const restores: (() => void)[] = [];

/** The shell's React commits since the count was last zeroed. */
const commits = { n: 0 };

function mount(reduced: boolean) {
  useEditorStore.getState().setEditMode({ mode: null });
  render(
    <Profiler id="shell" onRender={() => { commits.n++; }}>
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        <InputModeProvider inputMode="touch" shape="portrait"><I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider></InputModeProvider>
      </MotionConfig>
    </Profiler>,
  );
  fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
}

/** Lets the frames pass that a paint and a morph's play wait for. */
const frames = (n = 3) => act(async () => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); });
const grid = () => screen.getByTestId('shell-shelf-grid');
const handle = () => screen.getByTestId('shell-shelf-handle');
const step = async (key: 'ArrowUp' | 'ArrowDown', until: 'row' | 'grid') => {
  for (let i = 0; i < 12 && grid().dataset.arrangement !== until; i++) fireEvent.keyDown(handle(), { key });
  expect(grid().dataset.arrangement).toBe(until);
  await frames();
  // Time runs on past the morph, which the stand-in animations never reach by themselves.
  for (const a of env.animations) a.animation.finish();
};
/** The grid's turning height's slack either way, in frame px (`UprightObjectPanel.tsx:TURN_SLACK`). */
const SLACK = 4;
/** A card's name line and the gap over it, in frame px: the next row's names may stand out of view. */
const NAME_LINE = UPRIGHT_GRID.gap / 2 + TEXT.small * BAR_LINE_HEIGHT;
/** The commits one turn of the cards takes: the turn, and the scroll fade and panel claim it re-reads. */
const TURN_COMMITS = 4;

/**
 * Holds the panel's handle: `begin` passes the drag threshold and reads off the grid's live height
 * where it stands and how far it moves for a px of the finger, `to` then drags it until the grid
 * stands `live` frame px tall, and `release` lets go there. The grid turns where it holds one row with
 * its names, the gap and the next row's cards, reckoned from one row's least height, which a drag far
 * down reads off the clamp.
 */
function hold() {
  const at = (y: number) => ({ bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0, buttons: 1 });
  let y = 300;
  const move = async (to: number) => {
    y = to;
    fireEvent(handle(), new MouseEvent('pointermove', at(y)));
    await act(async () => {});
    return heightOf(grid());
  };
  fireEvent(handle(), new MouseEvent('pointerdown', at(y)));
  const drag = {
    least: 0, turnAt: 0, start: 0, perPx: 1,
    async begin() {
      // The move that passes the threshold commits the hold and draws nothing.
      await move(320);
      drag.start = await move(300);
      // Read upward: a grid resting at one row draws no lower.
      drag.perPx = (await move(290) - drag.start) / 10;
      drag.least = await move(100000);
      // One row's least is its cell and the gap's air around it; the next row adds the gap and its card.
      drag.turnAt = 2 * drag.least - UPRIGHT_GRID.gap - NAME_LINE;
      await move(300);
    },
    async to(live: number) { await move(300 + (drag.start - live) / drag.perPx); },
    async release() {
      fireEvent(handle(), new MouseEvent('pointerup', at(y)));
      await act(async () => {});
    },
  };
  return drag;
}

const morphsOn = (el: Element): RecordedAnimation[] => env.animations.filter((a) => a.target === el && a.animation.id === MORPH_ANIMATION);

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEW_W });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  window.dispatchEvent(new Event('resize'));
  layOut();
});
afterEach(() => {
  cleanup();
  __resetUprightGrid();
  env.restore();
  while (restores.length) restores.pop()!();
});

describe('the upright object panel turning its cards', () => {
  spec('UI-28', 'a turn keeps the same grid element and its cards', async () => {
    mount(false);
    await frames();
    const before = grid();
    const cards = cellsOf(before);
    await step('ArrowDown', 'row');
    expect(grid()).toBe(before);
    expect(cellsOf(grid())).toEqual(cards);
    await step('ArrowUp', 'grid');
    expect(grid()).toBe(before);
    expect(cellsOf(grid())).toEqual(cards);
  });

  spec('UI-28', 'the cards travel between the arrangements, and with reduced motion they turn with no animation and the grid carries no data-morphing', async () => {
    mount(false);
    await frames();
    await step('ArrowDown', 'row');
    expect(cellsOf(grid()).some((cell) => morphsOn(cell).length > 0)).toBe(true);
    cleanup();
    __resetUprightGrid();
    env.animations.length = 0;

    mount(true);
    await frames();
    await step('ArrowDown', 'row');
    await step('ArrowUp', 'grid');
    expect(cellsOf(grid()).flatMap(morphsOn)).toHaveLength(0);
    expect(grid().hasAttribute(MORPHING_ATTR)).toBe(false);
  });

  spec('UI-28', 'in touch mode the handle takes a fingertip around its grip, reaching above the panel\'s edge and not over the names under it', async () => {
    mount(false);
    await frames();
    const strip = handle();
    const reach = Array.from(strip.querySelectorAll<HTMLElement>('[data-touch-reach]')).find((el) => el.parentElement !== strip);
    expect(reach).toBeDefined();
    const inset = (side: 'top' | 'bottom' | 'left' | 'right') => -(parseFloat(reach!.style[side]) || 0);
    const own = { w: SEAM_HANDLE.grip.w + inset('left') + inset('right'), h: SEAM_HANDLE.grip.h + inset('top') + inset('bottom') };
    const zoom = zoomOf(strip);
    expect(own.w * zoom).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-9);
    expect(own.h * zoom).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-9);
    // It ends at the grip's foot, so the names row under the strip keeps its presses, and grows up past the panel's edge.
    expect(inset('bottom')).toBeCloseTo(0, 9);
    expect((SEAM_HANDLE.h - SEAM_HANDLE.grip.h) / 2 - inset('top')).toBeLessThan(0);
    // The strip itself grows no area of its own under the names.
    expect(Array.from(strip.children).some((el) => el.hasAttribute('data-touch-reach'))).toBe(false);
  });

  spec('UI-28', 'a drag commits React only as it begins, at each turn and as it ends, not on each move', async () => {
    mount(false);
    await frames();
    const drag = hold();
    await drag.begin();
    await drag.to(drag.turnAt + 4 * SLACK);
    await frames();
    commits.n = 0;
    // Forty moves on one side of the turn.
    for (let i = 0; i < 40; i++) await drag.to(drag.turnAt + 2 * SLACK + i);
    await frames();
    // Fewer than one commit in four moves: what commits meanwhile is the shell's own clock, not the drag.
    const still = commits.n;
    expect(still).toBeLessThan(40 / 4);
    // Forty moves that turn the cards twice commit a few times more for each turn.
    commits.n = 0;
    for (let i = 0; i <= 40; i++) await drag.to(drag.turnAt + 4 * SLACK * Math.cos((i / 40) * 2 * Math.PI));
    await frames();
    expect(grid().dataset.arrangement).toBe('grid');
    expect(commits.n - still).toBeLessThanOrEqual(2 * TURN_COMMITS);
    await drag.release();
  });
});
