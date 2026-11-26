/**
 * What the object shelf shows: the category it opens on, the planting card a row offers, its tabs
 * under a narrowing, and where the brush button stands and can paint.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ItemCategory } from '../../config/catalog/categories';
import { getCatalogByCategory } from '../../state/catalog';
import { placesOneAtATime } from '../../state/object-geometry';
import { nextEditMode, REST_INPUTS, type Arming } from '../../state/editing/edit-mode';
import {
  OBJECT_SHELF_TABS, brushBarRefusal, objectShelfView, openingCategory, planetShelfItems, revealingCard,
} from '../../state/object-shelf-view';
import { useEditorStore } from '../../state/store';
import { resetStore } from '../_support/store';
import { macroForShelfCategory } from '../../tools/macros/facts';

const patchOf = macroForShelfCategory;
/** A category whose row offers a planting card, and one whose row offers none. */
const PLANTED = OBJECT_SHELF_TABS.find((tab) => patchOf(tab.category) !== null)!.category;
const UNPLANTED = OBJECT_SHELF_TABS.find((tab) => patchOf(tab.category) === null)!.category;
const view = (over: Partial<Parameters<typeof objectShelfView>[0]> = {}) => objectShelfView({
  query: '', category: PLANTED, all: getCatalogByCategory(PLANTED), chooser: false, sourced: false, patchOf, ...over,
});

describe('the category the shelf opens on', () => {
  it("is the armed item's, else the planting card's, else the tab it was left on, else the first", () => {
    const item = getCatalogByCategory(ItemCategory.Bridge)[0]!;
    expect(openingCategory({ itemId: item.id, macro: null }, patchOf)).toBe(ItemCategory.Bridge);
    expect(openingCategory({ itemId: null, macro: patchOf(PLANTED) }, patchOf)).toBe(PLANTED);
    expect(openingCategory({ itemId: null, macro: null }, patchOf, UNPLANTED)).toBe(UNPLANTED);
    expect(openingCategory({ itemId: null, macro: null }, patchOf)).toBe(OBJECT_SHELF_TABS[0]!.category);
  });
});

describe("the shelf's row", () => {
  it('offers the planting card first in the categories it plants, never in a search or a narrowed row', () => {
    expect(view().patchId).toBe(patchOf(PLANTED));
    expect(view({ category: UNPLANTED, all: getCatalogByCategory(UNPLANTED) }).patchId).toBeNull();
    expect(view({ query: 'tree' }).patchId).toBeNull();
    expect(view({ only: () => true }).patchId).toBeNull();
  });

  it('shows only the tabs that still hold something under a narrowing', () => {
    const only = (item: { category: string }) => item.category === ItemCategory.Bridge;
    const narrowed = view({ only });
    expect(narrowed.tabs.map((tab) => tab.category)).toEqual([ItemCategory.Bridge]);
    expect(narrowed.items.every(only)).toBe(true);
  });

  it("stands the brush button on the live shelf only, available where some item can be painted", () => {
    expect(view().brushes).toBe(true);
    expect(view({ chooser: true }).brushes).toBe(false);
    const oneAtATime = getCatalogByCategory(ItemCategory.Bridge).filter(placesOneAtATime);
    expect(view({ category: ItemCategory.Bridge, all: oneAtATime }).paints).toBe(false);
    expect(view().paints).toBe(true);
  });

  it("is a planet session's own landmarks, with no tabs, search or brush", () => {
    const planet = view({ all: planetShelfItems(), sourced: true, query: 'tree' });
    expect(planet.tabs).toEqual([]);
    expect(planet.searching).toBe(false);
    expect(planet.brushes).toBe(false);
    expect(planet.patchId).toBeNull();
  });

  it('reveals an asked-for card once its own tab shows with no query', () => {
    const item = getCatalogByCategory(UNPLANTED)[0]!;
    expect(revealingCard(item.id, '', UNPLANTED)).toBe(item.id);
    expect(revealingCard(item.id, 'x', UNPLANTED)).toBeNull();
    expect(revealingCard(item.id, '', PLANTED)).toBeNull();
  });
});

describe('why the brush bar is refused', () => {
  afterEach(() => resetStore());

  const ONE_AT_A_TIME = getCatalogByCategory(ItemCategory.Bridge).find(placesOneAtATime)!.id;
  const PAINTED = getCatalogByCategory(PLANTED).find((item) => !placesOneAtATime(item))!.id;
  const armed = (arm: Arming) => ({ editMode: nextEditMode(REST_INPUTS, { mode: 'object', arm }) });

  it('names the planting card first, then an armed item placed one at a time, then a row with nothing to paint', () => {
    expect(brushBarRefusal(armed({ kind: 'none' }))).toBeNull();
    expect(brushBarRefusal(armed({ kind: 'item', itemId: PAINTED }))).toBeNull();
    expect(brushBarRefusal(armed({ kind: 'macro', macro: patchOf(PLANTED)! }), false)).toBe('planting');
    expect(brushBarRefusal(armed({ kind: 'item', itemId: ONE_AT_A_TIME }), false)).toBe('one-at-a-time');
    expect(brushBarRefusal(armed({ kind: 'item', itemId: PAINTED }), false)).toBe('row');
  });

  it('keeps the bar shut for every opener over what is armed', () => {
    const s = () => useEditorStore.getState();
    const opens = (arm: Arming): boolean => {
      s().setEditMode({ mode: 'object', arm });
      s().setObjectBrushBar(true);
      const open = s().objectBrushBar;
      s().setObjectBrushBar(false);
      return open;
    };
    expect(opens({ kind: 'none' })).toBe(true);
    expect(opens({ kind: 'item', itemId: PAINTED })).toBe(true);
    expect(opens({ kind: 'item', itemId: ONE_AT_A_TIME })).toBe(false);
    expect(opens({ kind: 'macro', macro: patchOf(PLANTED)! })).toBe(false);
  });
});
