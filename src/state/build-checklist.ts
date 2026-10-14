/**
 * The build checklist: everything standing on the map, counted, in the order someone rebuilding it
 * by hand in the game would need it.
 *
 * It derives, never counts: the per-item tallies come from `object-index.ts:countByCatalog` and the
 * per-layer cell counts from `map-stats.ts`, both memoized per GridState. A second walk over
 * `state.objects` here would be a second answer to a question those two already answer.
 *
 * Completeness is the point — someone builds from this, so an item silently missing is worse than
 * no list at all. Every entry of `countByCatalog` therefore lands somewhere: in its category's
 * list, the roads, the landmarks or `unresolved`, and `objectTotal` is the sum of the four. The
 * catalog's authored order fixes the order within a category (the same order the item shelf shows),
 * and anything placed that the authored list does not carry is appended rather than dropped.
 */
import type { GridState, CategoryId } from '../core/model/types';
import { isCoatingItem } from '../core/model/traits';
import { type LocalizedName, type Locale } from '../core/model/locale';
import type { Translate, I18nKey } from '../i18n/keys';
import { getAllItems, getCatalogByCategory, getCatalogItem, landmarkItems } from './catalog';
import { getMapStats } from './map-stats';
import { getObjectIndex } from './object-index';
import { placedCategories } from '../config/catalog/categories';

const CHECKLIST = placedCategories('checklistRank');

/** The categories a player places one by one, in the order the checklist reads them. Roads are kept
 *  apart: they are a surface laid by the brush, not a thing set down. */
const CHECKLIST_CATEGORIES: readonly CategoryId[] = CHECKLIST.map((c) => c.id);

/** The i18n key each category's card header reads under: the item shelf's own tab name, so a
 *  category is called the same thing wherever the app names it. */
export const CATEGORY_LABEL: Readonly<Record<string, I18nKey>> = Object.fromEntries(CHECKLIST.map((c) => [c.id, c.placement.tabKey]));

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
  category: CategoryId;
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
  /** Road surfaces by material, in catalog order, each counted in placed tiles. */
  roads: ChecklistItem[];
  roadTotal: number;
  /** Lowest layer first, which is the order the game requires: nothing stands on nothing. Only
   *  layers that carry something appear. */
  layers: ChecklistLayer[];
  /** Every object counted, the landmarks and the unresolved included. */
  objectTotal: number;
  /** The map's landmarks, in profile order: structures the game lays on the planet rather than
   *  items a player puts down. */
  landmarks: ChecklistItem[];
  landmarkTotal: number;
  /** Objects whose catalogId this build does not know. Zero for any map the loader accepted (it
   *  drops unknown ids), so a non-zero count means the list cannot name something that is there. */
  unresolved: number;
}

export function buildChecklist(state: GridState): BuildChecklist {
  const counts = getObjectIndex(state).countByCatalog;
  const consumed = new Set<string>();
  let objectTotal = 0;
  for (const n of counts.values()) objectTotal += n;

  const listOf = (catalog: Iterable<{ id: string; name: LocalizedName; icon?: string; color?: string }>): ChecklistItem[] => {
    const items: ChecklistItem[] = [];
    for (const item of catalog) {
      const count = counts.get(item.id) ?? 0;
      if (count === 0 || consumed.has(item.id)) continue;
      consumed.add(item.id);
      items.push({ catalogId: item.id, name: item.name, count, icon: item.icon, color: item.color });
    }
    return items;
  };
  const listFor = (category: CategoryId): ChecklistItem[] => listOf(getCatalogByCategory(category));

  const landmarks = listOf(landmarkItems());

  const groups: ChecklistGroup[] = CHECKLIST_CATEGORIES.map((category) => ({
    category, items: listFor(category), total: 0,
  }));
  const roads = listOf(getAllItems().filter(isCoatingItem));

  let unresolved = 0;
  for (const [id, count] of counts) {
    if (consumed.has(id)) continue;
    const item = getCatalogItem(id);
    const group = item ? groups.find((g) => g.category === item.category) : undefined;
    if (item && isCoatingItem(item)) {
      roads.push({ catalogId: id, name: item.name, count, icon: item.icon, color: item.color });
    } else if (item && group) {
      group.items.push({ catalogId: id, name: item.name, count, icon: item.icon, color: item.color });
    } else {
      unresolved += count;
    }
  }

  for (const group of groups) group.total = group.items.reduce((n, i) => n + i.count, 0);
  const roadTotal = roads.reduce((n, i) => n + i.count, 0);
  const landmarkTotal = landmarks.reduce((n, i) => n + i.count, 0);

  const stats = getMapStats(state);
  const layers: ChecklistLayer[] = [];
  for (let layer = 0; layer < stats.cellsByLayer.length; layer++) {
    const blocks = stats.cellsByLayer[layer] ?? 0;
    const water = stats.waterByLayer[layer] ?? 0;
    if (blocks > 0 || water > 0) layers.push({ layer, blocks, water });
  }

  return { groups, roads, roadTotal, layers, objectTotal, landmarks, landmarkTotal, unresolved };
}

/**
 * The checklist as a flat text sheet, for the "copy as text" button: a header line with the total,
 * the landmarks, one section per category card with its items as `  {count}x {name}`, roads with cell counts, and
 * terrain as one indented line per layer. Sections with nothing are omitted, same as the panel.
 *
 * Pure: everything it prints comes from `list` + `locale` + `t`, so a fixed `BuildChecklist`
 * fixture reproduces an exact string, which is what pins its shape in tests.
 */
export function buildChecklistText(list: BuildChecklist, locale: Locale, t: Translate): string {
  const nameOf = (name: LocalizedName): string => name[locale] ?? name.en;
  const groupsWithItems = list.groups.filter((g) => g.items.length > 0);
  const placedTotal = list.groups.reduce((n, g) => n + g.total, 0);
  const nothing = groupsWithItems.length === 0 && list.roads.length === 0 && list.layers.length === 0;

  const lines: string[] = [`${t('share.tab_game')}: ${t('checklist.total', { n: placedTotal })}`];

  if (list.landmarks.length > 0) {
    lines.push('', `${t('checklist.sec_landmarks')} (${list.landmarkTotal})`);
    for (const item of list.landmarks) lines.push(`  ${item.count}x ${nameOf(item.name)}`);
  }

  if (groupsWithItems.length > 0) {
    lines.push('', `${t('checklist.sec_objects')} (${placedTotal})`);
    for (const group of groupsWithItems) {
      const label = CATEGORY_LABEL[group.category];
      lines.push('', `${label ? t(label) : group.category} (${group.total})`);
      for (const item of group.items) lines.push(`  ${item.count}x ${nameOf(item.name)}`);
    }
  }

  if (list.roads.length > 0) {
    lines.push('', `${t('checklist.sec_roads')} (${t('units.cells', { n: list.roadTotal })})`);
    for (const item of list.roads) lines.push(`  ${nameOf(item.name)}: ${t('units.cells', { n: item.count })}`);
  }

  if (list.layers.length > 0) {
    lines.push('', `${t('checklist.sec_terrain')}:`);
    for (const layer of list.layers) {
      const label = layer.layer === 0 ? t('export.layer_ground') : t('export.layer_level', { n: layer.layer });
      const bits: string[] = [];
      if (layer.blocks > 0) bits.push(t('units.cells', { n: layer.blocks }));
      if (layer.water > 0) bits.push(t('checklist.water_part', { n: layer.water }));
      lines.push(`  ${label} ${bits.join(', ')}`);
    }
  }

  if (list.unresolved > 0) lines.push('', t('checklist.unknown', { n: list.unresolved }));
  if (nothing) lines.push('', t('checklist.empty'));

  return lines.join('\n');
}
