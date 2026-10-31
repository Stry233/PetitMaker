// @vitest-environment jsdom
/**
 * The object shelf: what a tab shows, what search finds, what a card arms, and what the badges say.
 * Arming is asserted on the resolved tool, not the inputs the click wrote, and the tabs against the
 * live catalog, so a new category fails here rather than going unreachable.
 */
import { placeObjectCommand } from '../../../../../core/model/command-build';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

import { CommandExecutor } from '../../../../../core/commands/command-executor';
import type { GridState, PlacedObject } from '../../../../../core/model/types';
import { ToolType } from '../../../../../state/editing/vocabulary';
import { I18nProvider, localizedName } from '../../../../../i18n/context';
import { createDefaultRegistry } from '../../../../../rules';
import {
  getCatalogByCategory, __setCatalogItem,
} from '../../../../../state/catalog';
import { useEditorStore } from '../../../../../state/store';
import { pickSelection } from '../../../../../editor/editing/pick-selection';
import { generateObjectId } from '../../../../../core/model/object-id';
import { ScaleProvider, fittedUiScale } from '../../../../../ui/design/scale';
import { ObjectShelf } from '../../../../../ui/shell/bars/objects/ObjectShelf';
import { InputModeProvider } from '../../../../../ui/design/input-mode';
import { spec } from '../../../../_support/spec';
import { GESTURE_TIMING } from '../../../../../platform/input/gesture-timing';
import { CARD, ROW, SCROLL, SEARCH, SHELF_BOX, TABS, planetShelfItems, shelfItems } from '../../../../../ui/shell/bars/objects/object-shelf';
import { newMap } from '../../../../../editor/operations/map';
import { editorPort } from '../../../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession } from '../../../../../editor/operations/planet-session';
import { host } from '../../../../../editor/host/host';
import { CONTROL_CLEARANCE } from '../../../../../ui/primitives/use-scroll-row';
import { wheelPush } from '../../../../../ui/primitives/scroll-input';
import { ShelfScrollbar } from '../../../../../ui/shell/bars/objects/ShelfScrollbar';
import { MOTIONS } from '../../../../../ui/design/motion/registry';
import { MODE, PLATE_BAND, SHELF_SCALE, TEXT, ZOOM } from '../../../../../ui/shell/units';
import { makeState } from '../../../../_support/map-state';
import { CATEGORIES, ItemCategory } from '../../../../../config/catalog/categories';
import { LANDMARKS } from '../../../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../../../_support/anchor';
import { createExecutor } from '../../../../../state/executor';
import { activeToolOf, armedItemOf, armedMacroOf } from '../../../../../state/editing/edit-mode';

function mount(itemId: string | null = null) {
  useEditorStore.getState().setEditMode({ mode: 'object', arm: itemId ? { kind: 'item', itemId } : { kind: 'none' } });
  return render(
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <ObjectShelf />
      </ScaleProvider>
    </I18nProvider>,
  );
}

/** The card row. */
function row(): HTMLElement {
  return document.getElementById('shell-shelf-row')!;
}

function cardNames(): string[] {
  return within(row()).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
}

/** The scroller holding the category names. */
function tabList(): HTMLElement {
  return screen.getAllByRole('tab')[0]!.parentElement as HTMLElement;
}

/** A live map on the store's own event bus, so a placement reaches the shelf's subscription. */
function installMap(): { state: GridState; exec: CommandExecutor } {
  const state = makeState(32, 32);
  const bus = useEditorStore.getState().eventBus;
  const exec = createExecutor(state, createDefaultRegistry(), bus);
  useEditorStore.setState({ gridState: state, commandExecutor: exec });
  return { state, exec };
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en' });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null });
  useEditorStore.getState().setEditMode({ mode: null, arm: { kind: 'none' } });
});

describe('the shelf tabs', () => {
  it('offers every placeable category and never road', () => {
    const tabbed = TABS.map((tab) => tab.category).sort();
    const expected = CATEGORIES.filter((c) => c.placement).map((c) => c.id).sort();
    expect(tabbed).toEqual(expected);
    expect(tabbed).not.toContain(ItemCategory.Road);
  });

  it('draws six tabs and no road tab', () => {
    mount();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.queryByRole('tab', { name: /road/i })).toBeNull();
  });

  it('shows only the chosen category', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    const trees = getCatalogByCategory(ItemCategory.Tree).map((i) => localizedName(i.name, 'en'));
    // Smart planting leads only the two categories it plants.
    expect(cardNames()).toEqual(['Smart planting', ...trees]);

    fireEvent.click(screen.getByRole('tab', { name: 'Bridges' }));
    const bridges = getCatalogByCategory(ItemCategory.Bridge).map((i) => localizedName(i.name, 'en'));
    expect(cardNames()).toEqual(bridges);
  });

  it('opens on the armed item\'s own category', () => {
    mount('tree-apple');
    expect(cardNames()).toContain('Apple Tree');
    expect(screen.getByRole('tab', { name: 'Trees' })).toHaveProperty('ariaSelected', 'true');
  });

  it('marks the chosen one with a stadium, whatever the label is wide', () => {
    mount();
    const mark = screen.getAllByTestId('shell-shelf-tab-mark')[0]!;
    // A radius of at least half the height gives semicircular caps at any label width.
    expect(Number.parseFloat(mark.style.borderRadius))
      .toBeGreaterThanOrEqual(Number.parseFloat(mark.style.height) / 2);
  });

  /** As in the game's category row; the active yellow on the chosen word would vanish against the sand. */
  it('marks the chosen one by the bar alone: every name is one colour on one outline', () => {
    mount();
    const words = screen.getAllByRole('tab').map((tab) => tab.firstElementChild as HTMLElement);
    const inks = new Set(words.map((w) => w.style.color));
    expect(inks).toEqual(new Set(['rgb(255, 254, 227)']));
    for (const word of words) expect(word.getAttribute('style')).toContain('-webkit-text-stroke');

    const marks = screen.getAllByTestId('shell-shelf-tab-mark');
    const filled = marks.filter((m) => m.style.background !== 'transparent');
    expect(filled).toHaveLength(1);
  });
});

/** jsdom has no layout, so these read the styles the row is laid out from. */
describe('the search field belongs to the row of names', () => {
  /** The input is a rectangle over the drawn capsule; `pw-field-wrap` and `pw-field-input` move the
   *  focus ring onto the wrapper (`animations.css`), which wears the stadium's corner. */
  it('is ringed as the pill it is drawn as when it takes focus', () => {
    expect(SEARCH.radius).toBe(SEARCH.h / 2);

    mount();
    const input = screen.getByRole('searchbox');
    const field = input.parentElement as HTMLElement;
    expect(input.classList.contains('pw-field-input')).toBe(true);
    expect(field.classList.contains('pw-field-wrap')).toBe(true);
    expect(field.style.borderRadius).toBe(`${SEARCH.radius}px`);
  });

  /** Russian, Thai and French names run half again as wide as Chinese; the names scroll instead. */
  it('never wraps onto a line of its own, whatever the names are wide', () => {
    mount();
    const row = screen.getByRole('searchbox').parentElement!.parentElement!.parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe('nowrap');
    expect(tabList().style.flexWrap).toBe('nowrap');
  });

  /** The tab list shrinks to nothing if needed while the search group does not shrink. */
  it('keeps its place by making the names the side that gives way', () => {
    mount();
    expect(tabList().style.flexShrink).toBe('1');
    expect(Number.parseFloat(tabList().style.minWidth)).toBe(0);
    expect((screen.getByRole('searchbox').parentElement!.parentElement as HTMLElement).style.flexShrink).toBe('0');
  });
});

/** Outside Chinese and Japanese the names overflow the room beside the search field, and wrapping
 *  would grow the shelf into the map. Overflow is simulated by declaring the row's scroll metrics. */
describe('the row of names travels sideways', () => {
  /** Declares a content width beyond the row's own, as a long language would produce. */
  function overflowing(clientWidth = 400, scrollWidth = 900): HTMLElement {
    const list = tabList();
    Object.defineProperty(list, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(list, 'scrollWidth', { value: scrollWidth, configurable: true });
    let left = 0;
    Object.defineProperty(list, 'scrollLeft', {
      get: () => left, set: (v: number) => { left = v; }, configurable: true,
    });
    return list;
  }

  it('is one line that scrolls, and hides the platform bar', () => {
    mount();
    const list = tabList();
    expect(list.style.overflowX).toBe('auto');
    expect(list.style.overflowY).toBe('hidden');
    expect(list.classList.contains('pw-noscroll')).toBe(true);
  });

  it('reveals the newly selected tab within its own row', () => {
    mount();
    const list = overflowing();
    const tabs = screen.getAllByRole('tab');
    const far = tabs[tabs.length - 1]!;
    Object.defineProperties(far, { offsetLeft: { value: 800 }, offsetWidth: { value: 100 } });
    fireEvent.click(far);
    expect(list.scrollLeft).toBe(500);
  });

  /** A second bar above the item row's would read as a second control; the names fade at an end
   *  they can still travel toward instead. */
  it('draws no bar of its own, and fades only at an end it can reach', async () => {
    mount();
    expect(screen.getAllByRole('scrollbar')).toHaveLength(1);

    const list = overflowing();
    expect(list.style.maskImage).toBe('');   // nothing measured yet

    // `useScrollFade` settles the mask over several frames after a scroll event.
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(list.style.maskImage).toContain('transparent 100%');   // room to the right
      expect(list.style.maskImage).not.toContain('transparent 0');  // flush at the start
    });

    list.scrollLeft = 500;
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(list.style.maskImage).toContain('transparent 0');
      expect(list.style.maskImage).not.toContain('transparent 100%');
    });
  });

  /** A scroll container clips at its padding box, which would cut the focus ring and hover growth off
   *  the end names; the padding is taken back as negative margin. */
  it('keeps room for a ring at its ends without moving either of them', () => {
    mount();
    const list = tabList();
    expect(list.style.padding).toBe(CONTROL_CLEARANCE);
    expect(list.style.margin).toBe(`calc(0px - ${CONTROL_CLEARANCE})`);
  });

  /** The two rows stand one above the other, so a notch travels the same distance in either
   *  (`scroll-input.ts:wheelPush`). */
  it('takes a wheel by the same rule the item row does', async () => {
    mount();
    const list = overflowing();

    // The live zoom includes the window's fit below the design reference.
    const zoom = ZOOM * fittedUiScale(window.innerWidth, window.innerHeight, 1);
    fireEvent.wheel(list, { deltaX: 0, deltaY: 100, deltaMode: 0 });
    // The notch glides (`wheelGlider`) and snaps to its exact target on arrival.
    await waitFor(() => expect(list.scrollLeft).toBeCloseTo(100 / zoom, 6), { timeout: 2000 });
    expect(list.scrollLeft).toBeCloseTo(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 400, zoom)!.by, 6);

    // A sideways wheel is left to the browser's native scroll.
    const was = list.scrollLeft;
    fireEvent.wheel(list, { deltaX: 40, deltaY: 0, deltaMode: 0 });
    expect(list.scrollLeft).toBe(was);
  });

  it('reveals the armed category when a search is cleared', () => {
    mount('facility-pavilion');
    const list = overflowing();
    const facilities = screen.getByRole('tab', { name: 'Facilities' });
    expect(facilities.getAttribute('aria-selected')).toBe('true');
    Object.defineProperties(facilities, { offsetLeft: { value: 800 }, offsetWidth: { value: 100 } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzznothing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(list.scrollLeft).toBe(500);
  });

  it('reveals a focused tab within its row and keeps every tab a tab stop', () => {
    mount();
    const list = overflowing();
    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) expect(tab.tabIndex).toBeGreaterThanOrEqual(0);
    const last = tabs[tabs.length - 1]!;
    Object.defineProperties(last, { offsetLeft: { value: 800 }, offsetWidth: { value: 100 } });
    fireEvent.focus(last);
    expect(list.scrollLeft).toBe(500);
  });
});

/** The item row's own scroll metrics decide its fade (`scroll-fade.ts`); the mask settles over real
 *  animation frames, so it is awaited. */
describe('the item row fades where it can still travel', () => {
  it('carries the mask only where scroll metrics say there is room', async () => {
    mount();
    const list = row();
    expect(list.style.maskImage).toBe('');

    Object.defineProperty(list, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(list, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(list, 'scrollLeft', { value: 50, configurable: true });
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(list.style.maskImage).toContain('linear-gradient(to right,');
      expect(list.style.maskImage).toContain('transparent 0');
      expect(list.style.maskImage).toContain('transparent 100%');
    });

    // Fitted: no room either way, no mask.
    Object.defineProperty(list, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(list, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(list);
    await waitFor(() => expect(list.style.maskImage).toBe(''));
  });
});

describe('search', () => {
  it('finds an item by its English name while the interface is Chinese', () => {
    useEditorStore.setState({ locale: 'zh' });
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'apple' } });
    expect(cardNames()).toContain('苹果树');
  });

  it('reaches across categories, so a query is not the tab', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bridge' } });
    const names = cardNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /bridge/i.test(n))).toBe(true);
    expect(screen.getAllByRole('tab').some((el) => el.getAttribute('aria-selected') === 'true')).toBe(false);
  });

  it('shows the category, not the whole catalog, for an empty or blank query', () => {
    mount();
    const buildings = getCatalogByCategory(ItemCategory.Building).map((i) => localizedName(i.name, 'en'));
    expect(cardNames()).toEqual(buildings);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } });
    expect(cardNames()).toEqual(buildings);
  });

  it('never offers a road, which has no tab of its own', () => {
    expect(shelfItems('road', ItemCategory.Building, 'en')
      .some((i) => i.category === ItemCategory.Road)).toBe(false);
  });

  it('says so when nothing matches, and clears back to the category', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzznothing' } });
    expect(cardNames()).toEqual([]);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(cardNames()).toEqual(
      getCatalogByCategory(ItemCategory.Building).map((i) => localizedName(i.name, 'en')),
    );
  });

  it('clicking a tab clears the query', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'apple' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
    expect(cardNames()).toEqual(
      ['Smart planting', ...getCatalogByCategory(ItemCategory.Flora).map((i) => localizedName(i.name, 'en'))],
    );
  });

  it('forgives a dropped letter (typo) via the subsequence fallback', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'aple' } });
    expect(cardNames()).toContain('Apple Tree');
  });

  /** The catalog has no cherry tree, so the peach tree carries the cherry blossom aliases, in
   *  several languages in one list. */
  it('finds an item through an authored alias, in English', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sakura' } });
    expect(cardNames()).toContain('Peach Tree');
  });

  it('finds an item through an authored alias, in Chinese', () => {
    useEditorStore.setState({ locale: 'zh' });
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '樱' } });
    expect(cardNames()).toContain('桃花树');
  });

  /** Both fixtures score the same with `fuzzyScore`, one on its name and one through an alias; the
   *  name wins the tie. */
  it('ranks an item\'s own name above an equal-score match reached only through another item\'s alias', () => {
    __setCatalogItem({
      id: 'test-shelf-rank-name', category: ItemCategory.Flora,
      name: { en: 'Zorbix' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
    });
    __setCatalogItem({
      id: 'test-shelf-rank-alias', category: ItemCategory.Flora,
      name: { en: 'Nettle' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [], aliases: ['Zorbix'],
    });
    const ids = shelfItems('zorbix', ItemCategory.Flora, 'en').map((i) => i.id);
    expect(ids.indexOf('test-shelf-rank-name')).toBeLessThan(ids.indexOf('test-shelf-rank-alias'));
  });
});

/** The bar's geometry comes from its props alone; the thumb travels the track less its own length,
 *  so it reaches the end. */
describe('the scrollbar', () => {
  function bar(scrollLeft: number, viewportW: number, contentW: number) {
    render(
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ShelfScrollbar
            scrollLeft={scrollLeft}
            viewportW={viewportW}
            contentW={contentW}
            onScrollTo={() => {}}
          />
        </ScaleProvider>
      </I18nProvider>,
    );
    const thumb = screen.getByTestId('shell-shelf-thumb');
    return {
      left: Number.parseFloat(thumb.style.left),
      width: Number.parseFloat(thumb.style.width),
    };
  }

  it('sits flush at the start and reaches the end, in a long row and a short one', () => {
    for (const [viewportW, contentW] of [[1000, 4000], [1000, 1100], [1000, 90_000]]) {
      const room = contentW! - viewportW!;
      const start = bar(0, viewportW!, contentW!);
      expect(start.left).toBe(0);
      cleanup();

      const end = bar(room, viewportW!, contentW!);
      expect(end.left + end.width).toBeCloseTo(100, 3);
      cleanup();
    }
  });

  it('reports how much of the row is on screen, down to a thumb the pointer can still hit', () => {
    const half = bar(0, 1000, 2000);
    expect(half.width).toBeCloseTo(50, 3);
    cleanup();

    // A sliver of a fraction is clamped to the thumb's minimum length.
    const sliver = bar(0, 1000, 90_000);
    expect(sliver.width).toBeCloseTo((SCROLL.thumb.minW / SCROLL.track.w) * 100, 3);
  });

  /** An empty track would read as a control that lost its handle. */
  it('fills the track when there is nothing to scroll', () => {
    const full = bar(0, 1000, 1000);
    expect(full.left).toBe(0);
    expect(full.width).toBe(100);
  });
});

/** `wheelPush` directly, since a jsdom scroll container has no room to scroll. */
describe('scrolling the row', () => {
  it('turns a wheel that reports downward into travel along the row', () => {
    expect(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800, 1)?.by).toBe(100);
    // Outside Chromium a wheel reports lines or pages; taken raw, a notch would move three pixels.
    expect(wheelPush({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800, 1)!.by).toBeGreaterThan(100);
    expect(wheelPush({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800, 1)!.by).toBe(800);
  });

  /** The row is drawn inside the frame's zoom while a wheel reports page pixels; the browser divides
   *  the zoom out of a sideways scroll, so a vertical notch must be divided too. */
  it('turns the same notch into the same travel as the browser does sideways', () => {
    expect(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800, 1.25)!.by).toBe(80);
    expect(wheelPush({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800, 1.25)!.by)
      .toBeCloseTo(wheelPush({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800, 1)!.by / 1.25);
    expect(wheelPush({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800, 1.25)!.by).toBe(800);
  });

  it('leaves a horizontal swipe to the browser, which is already scrolling this row', () => {
    expect(wheelPush({ deltaX: 40, deltaY: 0, deltaMode: 0 }, 800, 1)).toBeNull();
    expect(wheelPush({ deltaX: -12, deltaY: 3, deltaMode: 0 }, 800, 1)).toBeNull();
    expect(wheelPush({ deltaX: 0, deltaY: 0, deltaMode: 0 }, 800, 1)).toBeNull();
  });

  /** A trackpad's near-vertical swipe drifts a pixel or two sideways; the dominant direction decides. */
  it('takes a swipe that is mostly downward, drift and all', () => {
    expect(wheelPush({ deltaX: 3, deltaY: 100, deltaMode: 0 }, 800, 1.25)!.by).toBe(80);
    expect(wheelPush({ deltaX: -3, deltaY: -100, deltaMode: 0 }, 800, 1.25)!.by).toBe(-80);
  });

  /** The glide is the caller's business (`wheelGlider`). */
  it('says how far and nothing about gliding', () => {
    expect(Object.keys(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800, 1)!))
      .toEqual(['by']);
  });
});

describe('a card arms the item the map places', () => {
  it.each([null, 'tree-apple'])('reveals a sampled item through an existing search when %s is armed', (armed) => {
    const gs = makeState(24, 24);
    gs.objects.set('sample', { id: 'sample', catalogId: 'tree-apple', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 });
    useEditorStore.setState({ gridState: gs });
    mount(armed);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-matching-item' } });
    act(() => {
      useEditorStore.getState().setSelection([{ kind: 'object', id: 'sample' }]);
      pickSelection();
    });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('tab', { name: 'Trees' }).getAttribute('aria-selected')).toBe('true');
    expect(within(row()).getByRole('button', { name: 'Apple Tree' }).getAttribute('aria-pressed')).toBe('true');
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.ObjectPlacer);
  });

  it('arms on the first click and puts the item away on the second', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    const card = within(row()).getByRole('button', { name: 'Apple Tree' });

    fireEvent.click(card);
    expect(armedItemOf(useEditorStore.getState())).toBe('tree-apple');
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.ObjectPlacer);
    expect(within(row()).getByRole('button', { name: 'Apple Tree' })).toHaveProperty('ariaPressed', 'true');

    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    expect(armedItemOf(useEditorStore.getState())).toBeNull();
    // Nothing armed in object mode resolves to the hand tool.
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  it('arming one item disarms the one before it', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Peach Tree' }));
    expect(armedItemOf(useEditorStore.getState())).toBe('tree-peach');
    expect(within(row()).getByRole('button', { name: 'Apple Tree' })).toHaveProperty('ariaPressed', 'false');
  });
});

describe('switching category puts down a card that does not belong there', () => {
  it('puts down an armed item on a switch to a different category, and rests the map', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    expect(armedItemOf(useEditorStore.getState())).toBe('tree-apple');

    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    expect(armedItemOf(useEditorStore.getState())).toBeNull();
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  it('keeps an armed item on a switch to its own category', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(armedItemOf(useEditorStore.getState())).toBe('tree-apple');
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.ObjectPlacer);
  });

  it('keeps an armed patch-tree macro on a switch to Trees, and puts it down on a switch to Flowers', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(armedMacroOf(useEditorStore.getState())).toBe('patch-tree');

    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(armedMacroOf(useEditorStore.getState())).toBe('patch-tree');

    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    expect(armedMacroOf(useEditorStore.getState())).toBeNull();
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  it('puts down an armed patch-tree macro on a switch to Buildings', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(armedMacroOf(useEditorStore.getState())).toBe('patch-tree');

    fireEvent.click(screen.getByRole('tab', { name: 'Buildings' }));
    expect(armedMacroOf(useEditorStore.getState())).toBeNull();
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  /** A search reaches across categories, so the armed item can belong to a tab other than the
   *  remembered one. */
  it('puts down an item armed from a cross-category search on a switch to another tab', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'apple' } });
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    expect(armedItemOf(useEditorStore.getState())).toBe('tree-apple');

    fireEvent.click(screen.getByRole('tab', { name: 'Bridges' }));
    expect(armedItemOf(useEditorStore.getState())).toBeNull();
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });
});

describe('the smart-planting card arms per tab', () => {
  it('arms the tree-led planting from Trees and the flora-led one from Flora, never the same id', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(armedMacroOf(useEditorStore.getState())).toBe('patch-tree');

    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(armedMacroOf(useEditorStore.getState())).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(armedMacroOf(useEditorStore.getState())).toBe('patch-flora');
  });
});

describe('the placed count', () => {
  it('follows the map', async () => {
    const { exec } = installMap();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(screen.queryByLabelText('Placed: 1')).toBeNull();

    act(() => {
      const obj: PlacedObject = {
        id: generateObjectId(), catalogId: 'tree-apple',
        position: { x: 4, y: 4 }, rotation: 0, elevation: 0,
      };
      expect(exec.execute(placeObjectCommand(obj)).success).toBe(true);
    });

    await waitFor(() => expect(screen.getByLabelText('Placed: 1')).toBeTruthy());
  });
});

describe('the planet session shelf', () => {
  function mountSourced() {
    return render(
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ObjectShelf source={planetShelfItems} />
        </ScaleProvider>
      </I18nProvider>,
    );
  }

  it('offers the landmarks the planet editor places, each once per planet', () => {
    expect(planetShelfItems()).toEqual(LANDMARKS.filter((l) => l.editorPlaceable).map((l) => expect.objectContaining({ id: l.id, maxCount: 1 })));
  });

  it('lists only the landmarks while a session is open, with no tabs or search', () => {
    newMap(editorPort, 'hexia');
    enterPlanetSession(editorPort, null);
    try {
      mountSourced();
      expect(within(row()).getAllByRole('button').map((b) => b.dataset.catalogId)).toEqual(LANDMARKS.map((l) => l.id));
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.queryByRole('searchbox')).toBeNull();
      fireEvent.click(within(row()).getAllByRole('button')[0]!);
      expect(armedItemOf(useEditorStore.getState())).toBe(ANCHOR_LANDMARK.id);
    } finally {
      leavePlanetSession(editorPort);
      host.camera.takeQueued();
    }
  });

  it('keeps the catalog outside a session', () => {
    installMap();
    mountSourced();
    expect(screen.queryAllByRole('tab').length).toBeGreaterThan(0);
    expect(within(row()).queryAllByRole('button').some((b) => b.dataset.catalogId === ANCHOR_LANDMARK.id)).toBe(false);
  });
});

describe('the card is a picture and a count', () => {
  /** Footprint and turn are placement facts the ghost shows on the map. */
  it('carries no footprint badge and no turn mark', () => {
    mount();
    // A rotatable item, so a missing turn mark is the card's doing.
    const turns = getCatalogByCategory(ItemCategory.Building).find((i) => i.rotatable)!;
    expect(screen.queryAllByLabelText(`Takes ${turns.width} by ${turns.height} cells`)).toEqual([]);

    const card = within(row()).getByRole('button', { name: localizedName(turns.name, 'en') });
    expect(card.textContent).toBe('');
    const drawn = [...card.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
    expect(drawn.some((src) => /rotate/.test(src))).toBe(false);
  });

  /** The name is drawn by the shelf, outside the row, since the row clips on both axes. */
  it('names the item the pointer reaches, above the row', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(screen.queryByTestId('shell-card-name')).toBeNull();

    const card = within(row()).getByRole('button', { name: 'Apple Tree' });
    fireEvent.pointerEnter(card);
    const name = screen.getByTestId('shell-card-name');
    expect(name.textContent).toBe('Apple Tree');
    expect(row().contains(name)).toBe(false);

    fireEvent.pointerLeave(card);
    await waitFor(() => expect(screen.queryByTestId('shell-card-name')).toBeNull());
  });

  spec('UI-29', 'in touch mode the selected card wears its name, and a hold carries rather than names', () => {
    const apple = getCatalogByCategory(ItemCategory.Tree).find((i) => localizedName(i.name, 'en') === 'Apple Tree')!;
    useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: apple.id } });
    render(
      <I18nProvider>
        <InputModeProvider inputMode="touch">
          <ScaleProvider value={0.5}><ObjectShelf /></ScaleProvider>
        </InputModeProvider>
      </I18nProvider>,
    );
    expect(screen.getByTestId('shell-card-name').textContent).toBe('Apple Tree');
    fireEvent.pointerEnter(within(row()).getByRole('button', { name: localizedName(getCatalogByCategory(ItemCategory.Tree).find((i) => i.id !== apple.id)!.name, 'en') }));
    expect(screen.getByTestId('shell-card-name').textContent).toBe('Apple Tree');
  });

  spec('UI-29', 'in touch mode a chooser card names itself when held, and the hold picks nothing', () => {
    vi.useFakeTimers();
    try {
      const onPick = vi.fn();
      const trees = getCatalogByCategory(ItemCategory.Tree);
      render(
        <I18nProvider>
          <InputModeProvider inputMode="touch">
            <ScaleProvider value={0.5}>
              <ObjectShelf only={(i) => i.category === ItemCategory.Tree} pick={{ current: trees[0]!.id, onPick }} />
            </ScaleProvider>
          </InputModeProvider>
        </I18nProvider>,
      );
      fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
      const other = localizedName(trees[1]!.name, 'en');
      const card = within(row()).getByRole('button', { name: other });
      fireEvent.pointerDown(card, { pointerType: 'touch', button: 0 });
      act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs + 50); });
      expect(screen.getAllByTestId('shell-card-name').map((el) => el.textContent)).toContain(other);
      fireEvent.pointerUp(card, { pointerType: 'touch', button: 0 });
      fireEvent.click(card, { detail: 1 });
      expect(onPick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The shelf is proportioned against the game's own shelf (in a 1080-tall frame: a 119 px card, a band
 * 97 px above the bottom edge, 29 px name ink), not the design canvas. Asserted as ratios of the
 * declared layout, since jsdom lays nothing out.
 */
describe('the item card against the band it stands out of', () => {
  /** In CSS px. */
  const card = ROW.card * SHELF_SCALE;
  /** How far the card's own bottom edge stands above the window's, in css px: the scrollbar row,
   *  the gap over it, and the row's padding. */
  const cardBottom = SHELF_BOX.bottom + SCROLL.thumb.h * SHELF_SCALE
    + SHELF_BOX.rowGap + ROW.pad * SHELF_SCALE;

  it('keeps category names larger than mode captions', () => {
    expect(TEXT.shelfTab).toBeGreaterThan(MODE.label.size);
  });

  it('keeps the item\'s picture mostly clear of the band, as the game does', () => {
    const iconH = CARD.icon.h * SHELF_SCALE;
    const iconBottom = cardBottom + (card - iconH) / 2;
    const sunk = (PLATE_BAND.top - iconBottom) / iconH;
    expect(sunk).toBeLessThan(0.5);
    expect(sunk).toBeCloseTo(0.4, 1);   // the game's own
  });

  it('stands the card out of the band by the share the game stands its own', () => {
    expect((cardBottom + card - PLATE_BAND.top) / card).toBeCloseTo(0.55, 2);
  });
});

/** The cards are one keyed reel, so choosing a category remakes it and plays the entrance. */
describe('the row of cards arrives', () => {
  /** The element the cards stand in, which a category swap replaces. */
  const reel = () => row().querySelector('[data-catalog-id]')!.parentElement as HTMLElement;

  it('makes a new reel for the category chosen', () => {
    mount();
    const before = reel();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(reel()).not.toBe(before);
    expect(MOTIONS['shelf.category.swap'], 'the swap names no motion').toBeTruthy();
  });

  /** Typing is its own feedback, so a search stays one reel. */
  it('does not replay it on each letter of a search', () => {
    mount();
    const field = screen.getByRole('searchbox');
    fireEvent.change(field, { target: { value: 'a' } });
    const searching = reel();
    fireEvent.change(field, { target: { value: 'ap' } });
    expect(reel()).toBe(searching);
  });
});
