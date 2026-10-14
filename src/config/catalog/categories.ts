import type { CategoryRole } from '../../core/model/traits';
import type { CategoryId } from '../../core/model/types';
import type { CatalogEntry } from './catalog-entry';
import { facility } from './facility';
import { building } from './building';
import { tree } from './tree';
import { flora } from './flora';
import { road } from './road';
import { bridge } from './bridge';
import { ramp } from './ramp';
import type { I18nKey } from '../../i18n/keys';

/** The game's item categories. Only game data and its presentation name a member; shared code asks
 *  the category's `role` or an item's traits. */
export enum ItemCategory {
  Building = 'building',
  Tree = 'tree',
  Flora = 'flora',
  Road = 'road',
  Bridge = 'bridge',
  Ramp = 'ramp',
  Facility = 'facility',
}

/** How a category is offered for placing one item at a time. Each rank orders one surface. */
export interface CategoryPlacement {
  /** Icon basename `iconUrl` resolves, shared by the Place menu and the shelf. */
  readonly icon: string;
  /** Id of the Place menu action that arms the category. */
  readonly actionId: string;
  /** i18n key of the shelf tab, also the build checklist's card header. */
  readonly tabKey: I18nKey;
  /** i18n key of the Place menu entry. */
  readonly placeKey: I18nKey;
  /** Position in the Place menu. */
  readonly menuRank: number;
  /** Position among the shelf tabs, left to right. */
  readonly shelfRank: number;
  /** Position in the build checklist, the order a player rebuilding the map needs. */
  readonly checklistRank: number;
}

/** The generic 3D stand-in an item draws as when it has no model of its own: a trunk under a cone,
 *  a low bush, a roofed box, a capped kiosk, a deck on posts, a wedge the instance sizes, or a flat
 *  surface slab. */
export type StandInShape = 'tree' | 'bush' | 'house' | 'kiosk' | 'deck' | 'wedge' | 'slab';

export interface CategoryEntry {
  readonly id: ItemCategory;
  /** The category's items in authored order. */
  readonly items: readonly CatalogEntry[];
  /** i18n key listing the words a search may use for the category, separated by commas or ideographic commas. */
  readonly searchKey: I18nKey;
  /** Tint of the category's place and remove effects and of its 3D stand-in when the item has no colour. */
  readonly tint: number;
  /** The flat colour of the category's footprints on a top-down picture of the map. */
  readonly markColor: string;
  /** What the category's items are to the engines; absent where their traits say it. */
  readonly role?: CategoryRole;
  /** The 3D stand-in shape of the category's items. */
  readonly archetype: StandInShape;
  /** The stylize prompt's word for the category, where it names one. */
  readonly stylizeLabel?: 'building' | 'road' | 'plant';
  /** Absent for a surface laid by a brush rather than set down item by item. */
  readonly placement?: CategoryPlacement;
}

/**
 * Every item category, in catalog order. Generation determinism depends on catalog iteration
 * order, so this order never changes casually; each surface orders itself by its own rank.
 */
export const CATEGORIES: readonly CategoryEntry[] = [
  {
    id: ItemCategory.Facility, items: facility as CatalogEntry[], searchKey: 'catalog.terms_facility', tint: 0xfb923c, markColor: '#74b0d4', archetype: 'kiosk', role: 'amenity',
    placement: { icon: 'facility', actionId: 'facility', tabKey: 'shelf.tab_facility', placeKey: 'menu.place_facility', menuRank: 1, shelfRank: 5, checklistRank: 3 },
  },
  {
    id: ItemCategory.Building, items: building as CatalogEntry[], searchKey: 'catalog.terms_building', tint: 0xe6c48a, markColor: '#e8a857', archetype: 'house', role: 'home', stylizeLabel: 'building',
    placement: { icon: 'building', actionId: 'building', tabKey: 'shelf.tab_building', placeKey: 'menu.place_building', menuRank: 0, shelfRank: 0, checklistRank: 0 },
  },
  {
    id: ItemCategory.Tree, items: tree as CatalogEntry[], searchKey: 'catalog.terms_tree', tint: 0x7cc24a, markColor: '#5cb837', archetype: 'tree', role: 'canopy', stylizeLabel: 'plant',
    placement: { icon: 'tree', actionId: 'tree', tabKey: 'shelf.tab_tree', placeKey: 'menu.place_tree', menuRank: 2, shelfRank: 1, checklistRank: 1 },
  },
  {
    id: ItemCategory.Flora, items: flora as CatalogEntry[], searchKey: 'catalog.terms_flora', tint: 0xf2a8c8, markColor: '#7dba53', archetype: 'bush', role: 'groundcover', stylizeLabel: 'plant',
    placement: { icon: 'flower', actionId: 'flower', tabKey: 'shelf.tab_flora', placeKey: 'menu.place_flower', menuRank: 3, shelfRank: 2, checklistRank: 2 },
  },
  { id: ItemCategory.Road, items: road as CatalogEntry[], searchKey: 'catalog.terms_road', tint: 0xc4a882, markColor: '#d4c9b0', archetype: 'slab', stylizeLabel: 'road' },
  {
    id: ItemCategory.Bridge, items: bridge as CatalogEntry[], searchKey: 'catalog.terms_bridge', tint: 0xc7a06a, markColor: '#c4a06a', archetype: 'deck',
    placement: { icon: 'bridge', actionId: 'bridge', tabKey: 'shelf.tab_bridge', placeKey: 'menu.place_bridge', menuRank: 4, shelfRank: 3, checklistRank: 4 },
  },
  {
    id: ItemCategory.Ramp, items: ramp as CatalogEntry[], searchKey: 'catalog.terms_ramp', tint: 0xb8aeb0, markColor: '#b88c50', archetype: 'wedge',
    placement: { icon: 'ramp', actionId: 'ramp', tabKey: 'shelf.tab_ramp', placeKey: 'menu.place_ramp', menuRank: 5, shelfRank: 4, checklistRank: 5 },
  },
];

export const CATEGORY_BY_ID: ReadonlyMap<CategoryId, CategoryEntry> = new Map(CATEGORIES.map((c) => [c.id, c]));

export type PlacedCategory = CategoryEntry & { readonly placement: CategoryPlacement };

/** The categories placed item by item, ordered by the given surface's rank. */
export function placedCategories(rank: 'menuRank' | 'shelfRank' | 'checklistRank'): PlacedCategory[] {
  return CATEGORIES.filter((c): c is PlacedCategory => !!c.placement).sort((a, b) => a.placement[rank] - b.placement[rank]);
}
