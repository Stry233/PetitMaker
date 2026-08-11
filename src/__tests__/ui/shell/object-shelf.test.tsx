/**
 * The object shelf: what a tab shows, what search finds, what a card arms, and what the badges say.
 *
 * The arming assertions are on the RESOLVED tool, never on the inputs the click wrote: a card names
 * an item and `resolveEditMode` decides what the map holds, so a test that read the inputs back
 * would pass while the map was armed with nothing.
 *
 * The tabs are asserted against the LIVE catalog rather than a copy of the six names, so a seventh
 * category arrives here as a failure rather than as a category with no way to reach it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

import { CommandExecutor } from '../../../core/commands/command-executor';
import { ItemCategory, ToolType, type GridState, type PlacedObject } from '../../../core/model/types';
import { I18nProvider, localizedName } from '../../../i18n/context';
import { createDefaultRegistry } from '../../../rules';
import {
  getCatalogByCategory, getAllCategories, getCategoryMeta, registerCatalogItem,
} from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../tools/utils';
import { ScaleProvider } from '../../../ui/design/scale';
import { ObjectShelf } from '../../../ui/shell/bars/ObjectShelf';
import { CARD, ROW, SCROLL, SEARCH, SHELF_BOX, TABS, shelfItems } from '../../../ui/shell/bars/object-shelf';
import { wheelPush } from '../../../ui/shell/bars/row-scroll';
import { ShelfScrollbar } from '../../../ui/shell/bars/ShelfScrollbar';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import { PLATE_BAND, SHELF_SCALE, SHELF_TABS, TEXT, ZOOM, frameFit, standsInNameRow } from '../../../ui/shell/units';
import { makeState } from '../../rules/_helpers';

function mount(itemId: string | null = null) {
  useEditorStore.getState().setEditMode({ mode: 'object', itemId });
  return render(
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <ObjectShelf />
      </ScaleProvider>
    </I18nProvider>,
  );
}

/** The card row, which is where "how many items are showing" is asked. */
function row(): HTMLElement {
  return document.getElementById('shell-shelf-row')!;
}

function cardNames(): string[] {
  return within(row()).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
}

/** The row of category names, which is the scroller the names travel in. */
function tabList(): HTMLElement {
  return screen.getAllByRole('tab')[0]!.parentElement as HTMLElement;
}

/** A live map on the store's OWN event bus, so a placement reaches the shelf's subscription. */
function installMap(): { state: GridState; exec: CommandExecutor } {
  const state = makeState(32, 32);
  const bus = useEditorStore.getState().eventBus;
  const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
  useEditorStore.setState({ gridState: state, commandExecutor: exec });
  return { state, exec };
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en' });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null });
  useEditorStore.getState().setEditMode({ mode: null, itemId: null });
});

describe('the shelf tabs', () => {
  it('offers every placeable category and never road', () => {
    const tabbed = TABS.map((tab) => tab.category).sort();
    const expected = getAllCategories().filter((c) => getCategoryMeta(c)).sort();
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
    // The planting stands first in the two categories it plants, and in no other: a patch of
    // bridges is not a thing the placement rules would ever accept.
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
    // A radius at least half the height is what a browser clamps to semicircular caps; the mark's
    // width is its label's, so nothing here may depend on that.
    expect(Number.parseFloat(mark.style.borderRadius))
      .toBeGreaterThanOrEqual(Number.parseFloat(mark.style.height) / 2);
  });

  /**
   * The mark carries the choice on its own, exactly as the game's category row does. The chosen
   * WORD used to take the active yellow too, which put the one name the eye is looking for in the
   * lightest colour the interface has, over an island bordered in sand of nearly that colour.
   */
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

  it('stands the search field in the tab row rather than under it', () => {
    mount();
    const field = screen.getByRole('searchbox', { name: 'Search' }).parentElement as HTMLElement;
    const tablist = screen.getAllByRole('tab')[0]!.parentElement as HTMLElement;
    // Same flex line: the field is a sibling of the tab list, not a row of its own.
    expect(field.parentElement).toBe(tablist.parentElement);
    expect(field.previousElementSibling).toBe(tablist);
  });
});

/**
 * The field is part of the row of names, so what is asserted here is its relationship to them: how
 * big its own text is against its plate, where its bottom edge sits, and that a long language
 * cannot push it onto a line of its own. There is no layout in jsdom, so these read the numbers the
 * row is laid out FROM.
 */
describe('the search field belongs to the row of names', () => {
  it('carries text at its own em, the one the plate was drawn around', () => {
    // The design draws the plate 476 x 82 with a 44.5 px placeholder inside it. `TEXT.label` is the
    // 35 px em a TOOL's caption is drawn at: a different role that happened to share a constant,
    // and at that size the plate is an empty capsule with a word in the corner.
    expect(SEARCH.text).toBeGreaterThan(TEXT.label);
    expect(SEARCH.h / SEARCH.text).toBeCloseTo(82 / 44.5, 1);   // the drawing's proportion, at the row's size

    mount();
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.style.fontSize).toBe(`${SEARCH.text}px`);
    // The typed query stands where the placeholder did, so the field does not resize as it is used.
    expect(input.style.lineHeight).toBe(`${SEARCH.h}px`);
  });

  it('is centred on the names ink, not hung off the box that carries it', () => {
    // The one rule for everything standing in this row (`units.ts:standsInNameRow`), which the
    // other shelf's action pills take too: the plate brackets the words rather than aligning to the
    // line box, which holds slack under the ink and puts anything hung off it low against the row.
    expect(SEARCH.bottom).toBe(standsInNameRow(SEARCH.h));
    // Clear of the mark under the names, which is the row's own bottom edge.
    expect(SEARCH.bottom).toBeGreaterThan(SHELF_TABS.underline);
    // And taller than the words it stands beside, so it reaches past the line box below them.
    expect(SEARCH.bottom).toBeLessThan(SHELF_TABS.underline + SHELF_TABS.underlineGap);

    mount();
    const field = screen.getByRole('searchbox').parentElement as HTMLElement;
    expect(field.style.marginBottom).toBe(`${SEARCH.bottom}px`);
  });

  /**
   * An outline follows its OWN element's corner, and the input is a rectangle laid over the drawn
   * capsule: focused, it was ringed as a rectangle. `pw-field-wrap` + `pw-field-input` is the pair
   * `animations.css` moves the ring up with, and the box it lands on wears the plate's own corner,
   * which is half its height because the drawing is a stadium.
   */
  it('is ringed as the pill it is drawn as when it takes focus', () => {
    expect(SEARCH.radius).toBe(SEARCH.h / 2);

    mount();
    const input = screen.getByRole('searchbox');
    const field = input.parentElement as HTMLElement;
    expect(input.classList.contains('pw-field-input')).toBe(true);
    expect(field.classList.contains('pw-field-wrap')).toBe(true);
    expect(field.style.borderRadius).toBe(`${SEARCH.radius}px`);
  });

  /** Russian, Thai and French names are half again as wide as the Chinese, and a wrapping row put
   *  the field on a line of its own at the shelf's left edge, under the first name. Nothing in this
   *  row wraps now: the NAMES take the shortfall by scrolling, which is the block below. */
  it('never wraps onto a line of its own, whatever the names are wide', () => {
    mount();
    const row = screen.getByRole('searchbox').parentElement!.parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe('nowrap');
    expect(tabList().style.flexWrap).toBe('nowrap');
  });

  /** The field keeps its place because the NAMES give way: the tab list is the shrinkable item and
   *  can go to nothing, where the field is `flex: none`. A tab list that could not shrink below its
   *  own content would push the field off the end of the row instead. */
  it('keeps its place by making the names the side that gives way', () => {
    mount();
    expect(tabList().style.flexShrink).toBe('1');
    expect(Number.parseFloat(tabList().style.minWidth)).toBe(0);
    expect((screen.getByRole('searchbox').parentElement as HTMLElement).style.flexShrink).toBe('0');
  });
});

/**
 * The row of names travels sideways rather than onto a second line. Six names at one fixed size
 * are wider than the room beside the search field in every language but Chinese and Japanese, and
 * wrapping them grew the shelf upward into the map.
 *
 * jsdom lays nothing out, so the row can never actually overflow here: what these assert is the
 * arrangement that makes it scroll, and the behaviour, driven by declaring the two numbers the row
 * would have measured.
 */
describe('the row of names travels sideways', () => {
  /** Give the row a width and a content wider than it, the way a long language would. */
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

  /**
   * Six names is not forty cards: the item row below draws the design's own track and thumb, and a
   * second bar directly above it would read as a second control for the same shelf. The row says it
   * continues by fading at the end it can still travel toward, and says nothing when it cannot.
   */
  it('draws no bar of its own, and fades only at an end it can reach', async () => {
    mount();
    // One scrollbar in the shelf, and it belongs to the cards.
    expect(screen.getAllByRole('scrollbar')).toHaveLength(1);

    const list = overflowing();
    expect(list.style.maskImage).toBe('');   // nothing measured yet: nothing to say

    // The row now shares the item row's settle loop (`useScrollFade`), so a scroll event moves
    // the TARGET and the mask arrives over several frames rather than on the triggering event.
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

  /**
   * A scroll container clips at its padding box, so a focus ring — 3 px of outline 2 px out — and
   * the hover growth would be cut off the first and the last name. The slack is taken straight back
   * off as margin, which is what keeps the shelf's left edge and the search field where they were.
   */
  it('keeps room for a ring at its ends without moving either of them', () => {
    mount();
    const list = tabList();
    const pad = Number.parseFloat(list.style.padding);
    expect(pad).toBeGreaterThanOrEqual(5);
    expect(list.style.margin).toBe(`${-pad}px`);
  });

  /**
   * The same wheel rule the item row takes (`row-scroll.ts:wheelPush`), which is the point: the two
   * rows stand one above the other, and a notch has to travel the same distance in whichever of
   * them the pointer is over. Withholding the wheel here would also leave a name pushed off the end
   * with no pointer reach at all.
   */
  it('takes a wheel by the same rule the item row does', async () => {
    mount();
    const list = overflowing();

    // The live zoom carries the window's fit below the design reference (jsdom's window is one).
    const zoom = ZOOM * frameFit(window.innerWidth, window.innerHeight);
    fireEvent.wheel(list, { deltaX: 0, deltaY: 100, deltaMode: 0 });
    // The notch GLIDES (row-scroll.ts:wheelGlider), so the distance rule is pinned where the glide
    // settles: the run snaps to its exact target on arrival.
    await waitFor(() => expect(list.scrollLeft).toBeCloseTo(100 / zoom, 6), { timeout: 2000 });
    expect(list.scrollLeft).toBeCloseTo(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 400, zoom)!.by, 6);

    // A sideways wheel is the container's own scroll and the browser is already doing it.
    const was = list.scrollLeft;
    fireEvent.wheel(list, { deltaX: 40, deltaY: 0, deltaMode: 0 });
    expect(list.scrollLeft).toBe(was);
  });

  /**
   * The routes that are not a click on the name. The shelf opens on the ARMED item's category,
   * which can be the last of the six, and clearing a search puts a category back in force; neither
   * would scroll to the name on its own. jsdom implements no scrolling, so the call is the fact.
   */
  it('brings the chosen name back into view when it was not clicked', () => {
    const seen: HTMLElement[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      seen.push(this);
    };
    try {
      mount('facility-station');
      const facilities = screen.getByRole('tab', { name: 'Facilities' });
      expect(facilities.getAttribute('aria-selected')).toBe('true');
      expect(seen).toContain(facilities);

      // A search puts no name in force, and clearing it brings the category's own name back.
      seen.length = 0;
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzznothing' } });
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      expect(seen).toContain(screen.getByRole('tab', { name: 'Facilities' }));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  /** Every name stays a tab stop, and a focused one is brought into view: a row reachable only by a
   *  horizontal wheel is not reachable on most hardware. */
  it('brings a focused name into view, and keeps every one of them a tab stop', () => {
    const seen: HTMLElement[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      seen.push(this);
    };
    try {
      mount();
      const tabs = screen.getAllByRole('tab');
      for (const tab of tabs) expect(tab.tabIndex).toBeGreaterThanOrEqual(0);

      const last = tabs[tabs.length - 1]!;
      seen.length = 0;
      fireEvent.focus(last);
      expect(seen).toContain(last);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});

/**
 * The item row wears the same soft edge the tab row does (`ui/primitives/scroll-fade.ts`), on the
 * row itself rather than a copy of the mechanism: jsdom lays nothing out, so what is worth pinning
 * is that the row's own scroll metrics decide the mask, driven by declaring them the way a real
 * overflow would report them. The mask arrives and leaves over a settle loop rather than popping,
 * so what a scroll event produces is asserted with `waitFor` against the real (unstubbed)
 * `requestAnimationFrame` rather than synchronously against the triggering event.
 */
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

    // Fitted (no room to travel either way): the mask comes off rather than fading an end
    // it cannot reach.
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
    // No tab reads as chosen while a query stands.
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

  /** `state/catalog.ts:searchCatalog` now fuzzy-matches rather than requiring a literal substring,
   *  so a query missing one letter of a real word still finds it (the SUBSEQUENCE tier). */
  it('forgives a dropped letter (typo) via the subsequence fallback', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'aple' } });
    expect(cardNames()).toContain('Apple Tree');
  });

  /** The catalog has no "cherry tree" — the peach tree's pink blossoms are the closest in-game
   *  analog to what a visitor picturing sakura/cherry blossom is picturing, so that is where the
   *  alias lives (`config/catalog/tree/tree-peach.json`). Aliases mix languages in one list, same
   *  as the name fields already cross locales. */
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

  /** Two fixtures share the exact same match: one on its OWN name, the other only through an
   *  alias. `fuzzyScore` returns the identical raw number for both — what breaks the tie is which
   *  kind of field produced it, and the name wins ("ranks by best score, name match outranks
   *  equal alias match"). */
  it('ranks an item\'s own name above an equal-score match reached only through another item\'s alias', () => {
    registerCatalogItem({
      id: 'test-shelf-rank-name', category: ItemCategory.Flora,
      name: { en: 'Zorbix' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
    });
    registerCatalogItem({
      id: 'test-shelf-rank-alias', category: ItemCategory.Flora,
      name: { en: 'Nettle' }, icon: 'flower',
      width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
      traits: [], aliases: ['Zorbix'],
    });
    const ids = shelfItems('zorbix', ItemCategory.Flora, 'en').map((i) => i.id);
    expect(ids.indexOf('test-shelf-rank-name')).toBeLessThan(ids.indexOf('test-shelf-rank-alias'));
  });
});

/**
 * The bar under the row. Its geometry is computed from its props alone, so it can be asserted
 * without a layout: what matters is that the thumb's travel is the track LESS its own length, which
 * is the difference between reaching the end of the track and stopping a thumb-width short of it.
 */
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

    // A catalog long enough to make the true fraction a sliver stops at the drawn thumb's length.
    const sliver = bar(0, 1000, 90_000);
    expect(sliver.width).toBeCloseTo((SCROLL.thumb.minW / SCROLL.track.w) * 100, 3);
  });

  /** With everything in view the thumb is the whole track. An empty track reads as a control that
   *  lost its handle, and "all of it is on screen" is as much a state as any other. */
  it('fills the track when there is nothing to scroll', () => {
    const full = bar(0, 1000, 1000);
    expect(full.left).toBe(0);
    expect(full.width).toBe(100);
  });
});

/**
 * What a wheel does to the row, and how a scroll already running is added to. Neither can be
 * asserted through the component: jsdom lays nothing out, so a scroll container there has no room
 * to scroll at all.
 */
describe('scrolling the row', () => {
  it('turns a wheel that reports downward into travel along the row', () => {
    expect(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800, 1)?.by).toBe(100);
    // Lines and pages are what a wheel reports in outside Chromium; taken raw, a notch moved the
    // row three pixels.
    expect(wheelPush({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800, 1)!.by).toBeGreaterThan(100);
    expect(wheelPush({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800, 1)!.by).toBe(800);
  });

  /**
   * The row is drawn inside the frame's zoom, so one of its pixels is bigger than one of the
   * page's — and a wheel reports the page's. The browser scrolling this row from a HORIZONTAL wheel
   * already divides them out; a vertical notch handed straight to `scrollLeft` did not, and
   * travelled a quarter further at the shipped zoom. Measured over both axes, that was the whole of
   * the difference between them.
   */
  it('turns the same notch into the same travel as the browser does sideways', () => {
    expect(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800, 1.25)!.by).toBe(80);
    expect(wheelPush({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800, 1.25)!.by)
      .toBeCloseTo(wheelPush({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800, 1)!.by / 1.25);
    // A page is the row's OWN width, so it is already in the row's pixels.
    expect(wheelPush({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800, 1.25)!.by).toBe(800);
  });

  it('leaves a horizontal swipe to the browser, which is already scrolling this row', () => {
    expect(wheelPush({ deltaX: 40, deltaY: 0, deltaMode: 0 }, 800, 1)).toBeNull();
    expect(wheelPush({ deltaX: -12, deltaY: 3, deltaMode: 0 }, 800, 1)).toBeNull();
    expect(wheelPush({ deltaX: 0, deltaY: 0, deltaMode: 0 }, 800, 1)).toBeNull();
  });

  /** A trackpad's near-vertical swipe carries a pixel or two of sideways drift. Standing back from
   *  the whole gesture for it left the row moving by that drift alone: 2 px where 80 was asked
   *  for. The dominant direction decides, and the browser still adds the sideways part itself. */
  it('takes a swipe that is mostly downward, drift and all', () => {
    expect(wheelPush({ deltaX: 3, deltaY: 100, deltaMode: 0 }, 800, 1.25)!.by).toBe(80);
    expect(wheelPush({ deltaX: -3, deltaY: -100, deltaMode: 0 }, 800, 1.25)!.by).toBe(-80);
  });

  /** A wheel says only how far, never how it should get there. Smoothing a notch was measurably
   *  worse to use than the browser's own direct horizontal scroll of the same row, which is the
   *  comparison that settled it: the travel time lands between the hand and the row. */
  it('says how far and nothing about gliding, since the wheel no longer does', () => {
    expect(Object.keys(wheelPush({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800, 1)!))
      .toEqual(['by']);
  });
});

describe('a card arms the item the map places', () => {
  it('arms on the first click and puts the item away on the second', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    const card = within(row()).getByRole('button', { name: 'Apple Tree' });

    fireEvent.click(card);
    expect(useEditorStore.getState().selectedItemId).toBe('tree-apple');
    expect(useEditorStore.getState().activeTool).toBe(ToolType.ObjectPlacer);
    expect(within(row()).getByRole('button', { name: 'Apple Tree' })).toHaveProperty('ariaPressed', 'true');

    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    expect(useEditorStore.getState().selectedItemId).toBeNull();
    // A null id in object mode resolves to rest: nothing armed, so the map takes no marks.
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('arming one item disarms the one before it', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Peach Tree' }));
    expect(useEditorStore.getState().selectedItemId).toBe('tree-peach');
    expect(within(row()).getByRole('button', { name: 'Apple Tree' })).toHaveProperty('ariaPressed', 'false');
  });
});

describe('switching category puts down a card that does not belong there', () => {
  it('puts down an armed item on a switch to a different category, and rests the map', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    expect(useEditorStore.getState().selectedItemId).toBe('tree-apple');

    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    expect(useEditorStore.getState().selectedItemId).toBeNull();
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('keeps an armed item on a switch to its own category', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(useEditorStore.getState().selectedItemId).toBe('tree-apple');
    expect(useEditorStore.getState().activeTool).toBe(ToolType.ObjectPlacer);
  });

  it('keeps an armed patch-tree macro on a switch to Trees, and puts it down on a switch to Flowers', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(useEditorStore.getState().armedMacro).toBe('patch-tree');

    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(useEditorStore.getState().armedMacro).toBe('patch-tree');

    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    expect(useEditorStore.getState().armedMacro).toBeNull();
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('puts down an armed patch-tree macro on a switch to Buildings', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(useEditorStore.getState().armedMacro).toBe('patch-tree');

    fireEvent.click(screen.getByRole('tab', { name: 'Buildings' }));
    expect(useEditorStore.getState().armedMacro).toBeNull();
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  /** A search arms across categories on purpose (`shelfItems`), so an item picked while searching
   *  can belong to a category other than the one the tabs remember. A tab click always clears the
   *  query (`onSelect` above), which is the same call that checks the mismatch — so this is not a
   *  second path, but it is worth pinning as its own case. */
  it('puts down an item armed from a cross-category search on a switch to another tab', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'apple' } });
    fireEvent.click(within(row()).getByRole('button', { name: 'Apple Tree' }));
    expect(useEditorStore.getState().selectedItemId).toBe('tree-apple');

    fireEvent.click(screen.getByRole('tab', { name: 'Bridges' }));
    expect(useEditorStore.getState().selectedItemId).toBeNull();
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });
});

describe('the smart-planting card arms per tab (task #26)', () => {
  it('arms the tree-led planting from Trees and the flora-led one from Flora, never the same id', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(useEditorStore.getState().armedMacro).toBe('patch-tree');

    // Putting the card down disarms; switching tabs while nothing is armed offers the OTHER id.
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(useEditorStore.getState().armedMacro).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Flowers' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Smart planting' }));
    expect(useEditorStore.getState().armedMacro).toBe('patch-flora');
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
      expect(exec.execute(objectPlacementCommand(obj)).success).toBe(true);
    });

    await waitFor(() => expect(screen.getByLabelText('Placed: 1')).toBeTruthy());
  });
});

describe('the card is a picture and a count', () => {
  /**
   * The footprint and the turn mark are gone from the tile, and this is what would put them back:
   * both are facts about a PLACEMENT, answered by the ghost over the cell the item would land on,
   * where they can be acted on. Printed on eighty tiles they are badges the eye sorts through to
   * find the picture it came for.
   */
  it('carries no footprint badge and no turn mark', () => {
    mount();
    // A rotatable item, so the mark's absence is the card's doing and not the item's.
    const turns = getCatalogByCategory(ItemCategory.Building).find((i) => i.rotatable)!;
    expect(screen.queryAllByLabelText(`Takes ${turns.width} by ${turns.height} cells`)).toEqual([]);

    const card = within(row()).getByRole('button', { name: localizedName(turns.name, 'en') });
    expect(card.textContent).toBe('');
    const drawn = [...card.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
    expect(drawn.some((src) => /rotate/.test(src))).toBe(false);
  });

  /** The name is how you tell two cabins apart, so it is one hover away rather than gone: drawn by
   *  the SHELF, since the row clips on both axes and a label above a tile would be cut in half. */
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
});

/**
 * THE SHELF IS PROPORTIONED AGAINST THE GAME, not against the design canvas.
 *
 * The drawing gives the tile 280 design px and the backing band 217, which lands a card barely
 * bigger than the band; against a category name whose size is fixed by this frame's own rule, that
 * read as a row of stamps under a heading, and the item's picture sat half inside the dark bar. A
 * photograph of the game's own shelf (a 1080-tall frame) was measured instead: the card is 119 px,
 * the band shows 97 above the bottom edge, a name's ink is 29, and the numbers below are that.
 *
 * They are asserted from the LAYOUT the shelf is built from rather than from a rendered box, since
 * jsdom lays nothing out — every one of them is a ratio between two numbers declared here.
 */
describe('the item card against the band it stands out of', () => {
  /** As they land, in css px. */
  const card = ROW.card * SHELF_SCALE;
  /** How far the card's own bottom edge stands above the window's, in css px: the scrollbar row,
   *  the gap over it, and the row's padding. */
  const cardBottom = SHELF_BOX.bottom + SCROLL.thumb.h * SHELF_SCALE
    + SHELF_BOX.rowGap + ROW.pad * SHELF_SCALE;

  it('is 1.227 bands tall, which is what the game measures', () => {
    expect(card / PLATE_BAND.top).toBeCloseTo(1.227, 3);
  });

  /** The complaint was the text ratio, and this is the same number from the other end: text is
   *  fixed here, so the card's size is the only free term in it. The game's is 0.277. */
  it('carries a category name a little over a quarter of its own height', () => {
    expect(TEXT.shelfTab / card).toBeCloseTo(0.28, 2);
  });

  /**
   * The reported fault, in the terms it was reported in: half of the picture sat inside the dark
   * bar and in the game it does not. The picture is centred on the card, so where it meets the band
   * follows from the card's size and nothing else.
   */
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

  /** Every part of the tile is a share of it, so the drawing's proportions survive the resize
   *  rather than a fixed picture rattling around inside a bigger card. */
  it('scales the picture, the badge and the ring with the tile', () => {
    expect(CARD.icon.w / ROW.card).toBeCloseTo(224 / 280, 6);
    expect(CARD.icon.h / ROW.card).toBeCloseTo(168 / 280, 6);
    expect(CARD.radius / ROW.card).toBeCloseTo(32 / 280, 6);
    expect(ROW.gap / ROW.card).toBeCloseTo(38.6 / 280, 6);
  });
});

/**
 * Picking another name used to swap the whole row between two frames, which is the one place in
 * this shelf where something changes and nothing says so. The row of cards is one reel now, keyed,
 * so it is destroyed and remade — which is what plays the motion.
 */
describe('the row of cards arrives', () => {
  const reel = () => row().firstElementChild as HTMLElement;

  it('makes a new reel for the category chosen', () => {
    mount();
    const before = reel();
    fireEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(reel()).not.toBe(before);
    expect(MOTIONS['shelf.category.swap'], 'the swap names no motion').toBeTruthy();
  });

  /** A search narrows the row under the visitor's own typing, which is its own feedback: replaying
   *  an entrance per keystroke is noise, so every query is one reel. */
  it('does not replay it on each letter of a search', () => {
    mount();
    const field = screen.getByRole('searchbox');
    fireEvent.change(field, { target: { value: 'a' } });
    const searching = reel();
    fireEvent.change(field, { target: { value: 'ap' } });
    expect(reel()).toBe(searching);
  });
});
