/**
 * The build checklist: everything standing on the map, counted, in the order someone rebuilding it
 * by hand in the game would need it.
 *
 * It derives, never counts: the per-item tallies come from `object-index.ts:countByCatalog` and the
 * per-layer cell counts from `map-stats.ts`, both memoized per GridState. A second walk over
 * `state.objects` here would be a second answer to a question those two already answer.
 *
 * COMPLETENESS IS THE POINT — someone builds from this, so an item silently missing is worse than
 * no list at all. Every entry of `countByCatalog` therefore lands somewhere: in its category's
 * list, in the plaza count, or in `unresolved`, and `objectTotal` is the sum of the three. The
 * catalog's authored order fixes the order within a category (the same order the item shelf shows),
 * and anything placed that the authored list does not carry is appended rather than dropped.
 */
import { PLAZA_ID } from '../core/model/constants';
import { ItemCategory, type GridState, type LocalizedName, type Locale } from '../core/model/types';
import { getCatalogByCategory, getCatalogItem } from './catalog';
import { getMapStats } from './map-stats';
import { getObjectIndex } from './object-index';

/** The categories a player places one by one, in the order the checklist reads them. Roads are the
 *  seventh and are kept apart: they are a surface laid by the brush, not a thing set down. */
export const CHECKLIST_CATEGORIES: readonly ItemCategory[] = [
  ItemCategory.Building,
  ItemCategory.Tree,
  ItemCategory.Flora,
  ItemCategory.Facility,
  ItemCategory.Bridge,
  ItemCategory.Ramp,
];

/** The i18n key each category's card header reads under. Reuses the item shelf's own tab names,
 *  so a category is called the same thing wherever the app names it. */
export const CATEGORY_LABEL: Record<string, string> = {
  [ItemCategory.Building]: 'shelf.tab_building',
  [ItemCategory.Tree]: 'shelf.tab_tree',
  [ItemCategory.Flora]: 'shelf.tab_flora',
  [ItemCategory.Facility]: 'shelf.tab_facility',
  [ItemCategory.Bridge]: 'shelf.tab_bridge',
  [ItemCategory.Ramp]: 'shelf.tab_ramp',
};

export interface ChecklistItem {
  catalogId: string;
  /** The item's own name map, so the list speaks the reader's language without a per-item key. */
  name: LocalizedName;
  count: number;
  /** Icon PNG basename (resolved via `assets/icon-urls.ts:iconUrl`), carried from the catalog item
   *  so a reader of the list never looks the id back up. Absent for a road tile, which carries
   *  `color` instead. */
  icon?: string;
  /** A road tile's swatch fill, in place of an icon. */
  color?: string;
}

export interface ChecklistGroup {
  category: ItemCategory;
  items: ChecklistItem[];
  /** Objects in this group, summed. */
  total: number;
}

export interface ChecklistLayer {
  /** 0 is the ground: it holds no blocks, only the water dug into it. */
  layer: number;
  /** Blocks to place at this layer. A cell of height N takes one at every layer up to N. */
  blocks: number;
  /** Of the map's cells, those whose surface is water at exactly this layer. */
  water: number;
}

export interface BuildChecklist {
  /** The six placeable categories, always present, in `CHECKLIST_CATEGORIES` order. An empty
   *  group is kept so the reader can see that a category has nothing rather than wonder. */
  groups: ChecklistGroup[];
  /** Road surfaces by material, in catalog order. A road tile is 1x1, so a count is a cell count. */
  roads: ChecklistItem[];
  roadTotal: number;
  /** Lowest layer first, which is the order the game requires: nothing stands on nothing. Only
   *  layers that carry something appear. */
  layers: ChecklistLayer[];
  /** Every object counted, the plaza and the unresolved included. */
  objectTotal: number;
  /** Whether the map carries the locked central plaza, which is part of the map rather than
   *  something a player puts down. */
  hasPlaza: boolean;
  /** Objects whose catalogId this build does not know. Zero for any map the loader accepted (it
   *  drops unknown ids), so a non-zero count means the list cannot name something that is there. */
  unresolved: number;
}

export function buildChecklist(state: GridState): BuildChecklist {
  const counts = getObjectIndex(state).countByCatalog;
  const consumed = new Set<string>();
  let objectTotal = 0;
  for (const n of counts.values()) objectTotal += n;

  const listFor = (category: ItemCategory): ChecklistItem[] => {
    const items: ChecklistItem[] = [];
    for (const item of getCatalogByCategory(category)) {
      const count = counts.get(item.id) ?? 0;
      if (count === 0) continue;
      consumed.add(item.id);
      items.push({ catalogId: item.id, name: item.name, count, icon: item.icon, color: item.color });
    }
    return items;
  };

  const groups: ChecklistGroup[] = CHECKLIST_CATEGORIES.map((category) => ({
    category, items: listFor(category), total: 0,
  }));
  const roads = listFor(ItemCategory.Road);

  let hasPlaza = false;
  let unresolved = 0;
  for (const [id, count] of counts) {
    if (consumed.has(id)) continue;
    if (id === PLAZA_ID) { hasPlaza = true; continue; }
    const item = getCatalogItem(id);
    const group = item ? groups.find((g) => g.category === item.category) : undefined;
    if (item && item.category === ItemCategory.Road) {
      roads.push({ catalogId: id, name: item.name, count, icon: item.icon, color: item.color });
    } else if (item && group) {
      group.items.push({ catalogId: id, name: item.name, count, icon: item.icon, color: item.color });
    } else {
      unresolved += count;
    }
  }

  for (const group of groups) group.total = group.items.reduce((n, i) => n + i.count, 0);
  const roadTotal = roads.reduce((n, i) => n + i.count, 0);

  const stats = getMapStats(state);
  const layers: ChecklistLayer[] = [];
  for (let layer = 0; layer < stats.cellsByLayer.length; layer++) {
    const blocks = stats.cellsByLayer[layer] ?? 0;
    const water = stats.waterByLayer[layer] ?? 0;
    if (blocks > 0 || water > 0) layers.push({ layer, blocks, water });
  }

  return { groups, roads, roadTotal, layers, objectTotal, hasPlaza, unresolved };
}

/** A translate-like function: `state/` sits below `i18n/` in the import ladder (see
 *  `__tests__/import-direction.test.ts`), so this module cannot reach for `i18n/context.ts`
 *  itself. The caller (a component holding `useT()`, or a test binding `translateFor` to a fixed
 *  locale) supplies one. */
export type ChecklistTranslate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The checklist as a flat text sheet, for the "copy as text" button: a header line with the total,
 * one section per category card with its items as `  {count}x {name}`, roads with cell counts, and
 * terrain as one line of per-layer parts. Sections with nothing are omitted, same as the panel.
 *
 * Pure: everything it prints comes from `list` + `locale` + `t`, so a fixed `BuildChecklist`
 * fixture reproduces an exact string, which is what pins its shape in tests.
 */
export function buildChecklistText(list: BuildChecklist, locale: Locale, t: ChecklistTranslate): string {
  const nameOf = (name: LocalizedName): string => name[locale] ?? name.en;
  const groupsWithItems = list.groups.filter((g) => g.items.length > 0);
  const placedTotal = list.groups.reduce((n, g) => n + g.total, 0);
  const nothing = groupsWithItems.length === 0 && list.roads.length === 0 && list.layers.length === 0;

  const lines: string[] = [`${t('share.tab_game')}: ${t('checklist.total', { n: placedTotal })}`];

  if (groupsWithItems.length > 0) {
    lines.push('', `${t('checklist.sec_objects')} (${placedTotal})`);
    for (const group of groupsWithItems) {
      lines.push('', `${t(CATEGORY_LABEL[group.category] ?? group.category)} (${group.total})`);
      for (const item of group.items) lines.push(`  ${item.count}x ${nameOf(item.name)}`);
    }
  }

  if (list.roads.length > 0) {
    lines.push('', `${t('checklist.sec_roads')} (${t('checklist.cells', { n: list.roadTotal })})`);
    for (const item of list.roads) lines.push(`  ${nameOf(item.name)}: ${t('checklist.cells', { n: item.count })}`);
  }

  if (list.layers.length > 0) {
    const parts = list.layers.map((layer) => {
      const label = layer.layer === 0 ? t('export.layer_ground') : t('export.layer_level', { n: layer.layer });
      const bits: string[] = [];
      if (layer.blocks > 0) bits.push(t('checklist.cells', { n: layer.blocks }));
      if (layer.water > 0) bits.push(t('checklist.water_part', { n: layer.water }));
      return `${label} ${bits.join(', ')}`;
    });
    lines.push('', `${t('checklist.sec_terrain')}: ${parts.join(' · ')}`);
  }

  if (list.unresolved > 0) lines.push('', t('checklist.unknown', { n: list.unresolved }));
  if (nothing) lines.push('', t('checklist.empty'));

  return lines.join('\n');
}
