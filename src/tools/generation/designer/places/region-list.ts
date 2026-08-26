/**
 * Stage 1 of the methodology pipeline (步骤 1 · 定区域清单): WHICH regions this map holds.
 *
 * Two halves:
 *  - FIXED — the building-anchor regions must cover the building set, and the building set must all
 *    be placed (the methodology's first hard rule). Every placeable Building and Facility is assigned
 *    to exactly one anchor region by IDENTITY, through the `ANCHOR_ROLES` table below; an id the table
 *    does not know falls back by category, so a future catalog item joins a region rather than going
 *    missing.
 *  - RANDOM — the pure theme regions are drawn from the theme library, count and types seeded.
 *    Richness scales the COUNT only, within the methodology's bounds; it never adds a kind of region
 *    the library does not hold and never drops an anchor.
 *
 * Nothing here knows where anything goes: `layout.ts` places these specs. Deterministic per
 * (seed, catalog order, richness) and free of any browser API, so it runs inside the worker pool.
 *
 * SIZING. A lot size here is a coarse PLAN-level footprint, larger than the ~48-cell regions the
 * target island measures: those are the terrace-and-road fabric a lot gets CUT INTO by the terracing
 * and the kits, not the lot itself. A map plans 12 to 24 lots (6 anchors plus 6 to 18 themes); the
 * measured region count arrives later, when the fabric subdivides them.
 */
import { ItemCategory, type CatalogItem } from '../../../../core/model/types';
import { makeRng, type Rng } from '../../../../core/model/rng';
import { getPlaceableByCategory } from '../../../../state/catalog';
import type { AffinityTag, AnchorKind, RegionSpec, ThemeFamily, ThemeId } from '../types';

// --- the anchor mapping ------------------------------------------------------------------------

/** Which anchor region each placeable Building/Facility belongs to, one row per catalog item.
 *
 *  The methodology names four anchors (小动物住宅 / 自家住宅 / 博物馆（万象馆）/ 商店). The catalog
 *  carries no museum item, so the row for it says which item stands in and why. Order is the
 *  catalog's. */
export const ANCHOR_ROLES: ReadonlyArray<{ id: string; role: AnchorKind; note: string }> = [
  // The eight animal-home cabins (小动物住宅). They group into residential clusters.
  { id: 'building-bamboo-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-boat-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-fluorite-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-forest-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-plush-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-starbay-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-sunset-cabin', role: 'residential', note: 'animal home' },
  { id: 'building-wave-cabin', role: 'residential', note: 'animal home' },
  // The consignment stall is 1x1 street furniture, not a dwelling, but it is a Building the hard
  // rule demands on the map; it joins a residential cluster as its shopfront (the target island
  // stands it in a paved street corner with 37 paved cells within 3).
  { id: 'building-stall', role: 'residential', note: 'street stall, joins a residential cluster' },
  // The player's own house: its own region (自家住宅).
  { id: 'building-myhouse', role: 'own-house', note: "the player's own house" },
  // No 万象馆 exists in the catalog. The pavilion is the only civic non-commercial building, so it
  // stands in as the museum anchor: a visited building with a forecourt and a view.
  { id: 'facility-pavilion', role: 'museum', note: 'museum stand-in (no 万象馆 in the catalog)' },
  // The shop, literally.
  { id: 'facility-shop', role: 'shop', note: 'the shop' },
  // The station is `ruleTBD`, so `getPlaceableByCategory` never offers it and no plan can demand
  // it. The row exists so that the day its rule lands it joins the shop's civic region rather than
  // falling through to the by-category default.
  { id: 'facility-station', role: 'shop', note: 'ruleTBD today; civic when its rule lands' },
];

const ROLE_BY_ID = new Map(ANCHOR_ROLES.map((r) => [r.id, r.role] as const));

/** The anchor region an item belongs to. Unknown ids fall back by category — a new Building is a
 *  dwelling, a new Facility is civic — so the hard rule cannot be broken by adding an item. */
export function anchorRoleOf(item: CatalogItem): AnchorKind {
  return ROLE_BY_ID.get(item.id) ?? (item.category === ItemCategory.Building ? 'residential' : 'shop');
}

/** Every item a plan must find a home for: the placeable Buildings and Facilities, in catalog
 *  order. Matches `eval/scorecard.ts:anchorCatalogIds`, which is what the hard ledger checks. */
export function anchorCatalogItems(): CatalogItem[] {
  return [
    ...getPlaceableByCategory(ItemCategory.Building),
    ...getPlaceableByCategory(ItemCategory.Facility),
  ];
}

// --- the theme library (纯主题区清单) -----------------------------------------------------------

export interface ThemeSpec {
  id: ThemeId;
  family: ThemeFamily;
  /** The coarse lot this theme wants, in macro cells. */
  size: { w: number; h: number };
  tags: readonly AffinityTag[];
  /** Draw weight. The methodology picks types at random; the weights only say that a park is a
   *  commoner sight than a canyon, never that a type is unreachable. */
  weight: number;
  /** Below this richness the theme is not drawn at all. Only the landmark region uses it:
   *  文字/图案景观 is an occasional set piece, gated on richness and on lot width. */
  minRichness?: number;
}

export const THEME_LIBRARY: readonly ThemeSpec[] = [
  // 吃喝休闲
  { id: 'cafe', family: 'food-leisure', size: { w: 11, h: 9 }, tags: ['drink'], weight: 3 },
  { id: 'teahouse', family: 'food-leisure', size: { w: 10, h: 9 }, tags: ['drink', 'quiet'], weight: 2 },
  { id: 'picnic', family: 'food-leisure', size: { w: 11, h: 9 }, tags: ['greenery'], weight: 2 },
  { id: 'banquet', family: 'food-leisure', size: { w: 11, h: 10 }, tags: [], weight: 2 },
  { id: 'seaside-dining', family: 'food-leisure', size: { w: 13, h: 9 }, tags: ['drink', 'seaside', 'waterside'], weight: 2 },
  // 自然景观
  { id: 'park', family: 'nature', size: { w: 15, h: 13 }, tags: ['greenery'], weight: 3 },
  { id: 'garden', family: 'nature', size: { w: 11, h: 10 }, tags: ['greenery'], weight: 3 },
  { id: 'flower-field', family: 'nature', size: { w: 13, h: 11 }, tags: ['greenery'], weight: 3 },
  { id: 'bamboo-court', family: 'nature', size: { w: 11, h: 11 }, tags: ['bamboo', 'quiet'], weight: 2 },
  { id: 'lake-fountain', family: 'nature', size: { w: 13, h: 11 }, tags: ['waterside'], weight: 2 },
  { id: 'tree-avenue', family: 'nature', size: { w: 19, h: 7 }, tags: ['greenery'], weight: 2 },
  { id: 'mountain-water', family: 'nature', size: { w: 15, h: 13 }, tags: ['waterside'], weight: 2 },
  { id: 'canyon', family: 'nature', size: { w: 17, h: 9 }, tags: [], weight: 1 },
  // 观景 / 打卡
  { id: 'lookout', family: 'viewpoint', size: { w: 9, h: 9 }, tags: [], weight: 2 },
  { id: 'panorama-deck', family: 'viewpoint', size: { w: 11, h: 9 }, tags: [], weight: 2 },
  { id: 'waterside-deck', family: 'viewpoint', size: { w: 13, h: 7 }, tags: ['waterside'], weight: 2 },
  { id: 'landmark-text', family: 'viewpoint', size: { w: 21, h: 15 }, tags: [], weight: 1, minRichness: 0.6 },
  // 文化 / 活动
  { id: 'library', family: 'culture', size: { w: 11, h: 10 }, tags: ['library', 'quiet'], weight: 2 },
  { id: 'stage', family: 'culture', size: { w: 13, h: 11 }, tags: ['stage'], weight: 2 },
  { id: 'chess-garden', family: 'culture', size: { w: 9, h: 9 }, tags: ['quiet'], weight: 2 },
  { id: 'music-corner', family: 'culture', size: { w: 9, h: 9 }, tags: ['quiet'], weight: 2 },
  // 生产 / 生活
  { id: 'crop-field', family: 'production', size: { w: 15, h: 13 }, tags: [], weight: 2 },
  { id: 'orchard', family: 'production', size: { w: 15, h: 11 }, tags: ['greenery'], weight: 2 },
  { id: 'animal-run', family: 'production', size: { w: 13, h: 11 }, tags: [], weight: 2 },
];

// --- counts ------------------------------------------------------------------------------------

/** Theme-region count at richness 0 and 1. With ~6 anchor regions the plan holds 12 to 24 lots, the
 *  coarse band the target island's 69 measured regions subdivide from. */
export const THEME_COUNT = { min: 6, max: 18 } as const;

/** How many pure theme regions a map of this richness holds. Monotone in richness by construction
 *  (a rounded affine map), which is what the richness probe pins. */
export function themeCount(richness: number): number {
  const r = clamp01(richness);
  return Math.round(THEME_COUNT.min + (THEME_COUNT.max - THEME_COUNT.min) * r);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- anchor lot sizing ---------------------------------------------------------------------------

/** Room a home needs beside its neighbours: the gate strip is 3 wide and 2 deep
 *  (`placement/object.ts:buildingGate`), plus the 1-cell street margin the populator keeps. */
const HOME_PAD = { x: 2, y: 3 };
/** Border inside a lot, so a building never sits on the lot's own edge. */
const LOT_BORDER = 2;
/** The ground a single home takes beyond its own footprint: the garden, bed or court composed round
 *  it. The reference gives every building its own surroundings rather than a shared yard. */
const HOME_GARDEN = 2;

/** The lot an anchor region wants and the floor it may shrink to. `extra` is the composition
 *  allowance that anchor's own case implies; the floor drops it and keeps only what the buildings
 *  themselves need, since placing them is the hard rule.
 *
 *  Rotation is the layout's to choose (the door must face the entry), so a building is budgeted at
 *  its longest side in BOTH axes: a 5x4 cabin turned 90° is 4x5. */
function anchorLotSize(
  members: readonly CatalogItem[], extra: number,
): { size: { w: number; h: number }; minSize: { w: number; h: number } } {
  const cols = members.length <= 2 ? members.length : 2;
  const rows = Math.ceil(members.length / cols);
  const side = Math.max(...members.map((m) => Math.max(m.width, m.height)));
  return {
    size: {
      w: cols * (side + HOME_PAD.x) + LOT_BORDER + extra,
      h: rows * (side + HOME_PAD.y) + LOT_BORDER + extra,
    },
    // The floor is the building plus its gate strip and nothing else. Twelve anchors ask for twelve
    // blocks that can hold a fronted lot, and a terraced seed does not always have twelve
    // roomy ones; placing every building is the methodology's one hard rule, so the last resort is
    // a lot with no garden rather than a map missing a home.
    minSize: { w: cols * side + LOT_BORDER, h: rows * (side + 1) + LOT_BORDER },
  };
}

// --- the list ------------------------------------------------------------------------------------

/**
 * Stage 1. Returns the anchor regions (covering `catalog` exactly once) followed by the theme
 * regions, in the order the layout should place them.
 *
 * @param catalog the placeable Buildings and Facilities; defaults to the live catalog's.
 */
export function planRegionList(
  seed: number,
  catalog: readonly CatalogItem[] = anchorCatalogItems(),
  richness = 0.5,
): RegionSpec[] {
  const rng = makeRng((seed ^ 0x5eed1157) >>> 0);
  return [...anchorRegions(rng, catalog), ...themeRegions(rng, richness)];
}

function anchorRegions(rng: Rng, catalog: readonly CatalogItem[]): RegionSpec[] {
  const byRole = new Map<AnchorKind, CatalogItem[]>();
  for (const item of catalog) {
    const role = anchorRoleOf(item);
    const list = byRole.get(role) ?? [];
    list.push(item);
    byRole.set(role, list);
  }
  const regions: RegionSpec[] = [];

  // EVERY HOME IS ITS OWN REGION. The style target stands its twelve buildings 13 to 70 cells from
  // the plaza, each with its own composition around it and a different neighbourhood at every one, so
  // a region per home is what gives each its own garden and lets the layout spread them across the
  // island. Gathering them into clusters of two to four is a fair reading of 住宅区, and it puts most
  // of a map's houses in one block.
  const homes = shuffled(rng, byRole.get('residential') ?? []);
  byRole.delete('residential');
  for (const home of homes) {
    const { size, minSize } = anchorLotSize([home], HOME_GARDEN);
    regions.push({
      id: `res-${regions.length}`,
      kind: 'residential',
      anchors: [home.id],
      size, minSize,
      tags: ['dwelling'],
    });
  }

  // The remaining anchor kinds, one region each, in a fixed order so a plan reads the same way.
  for (const kind of ['own-house', 'museum', 'shop'] as const) {
    const members = byRole.get(kind) ?? [];
    if (members.length === 0) continue;
    // The shop's case rings it with a one-layer mountain carrying a library and a cafe, so
    // its lot is the roomiest of the three; the museum wants a forecourt; the own house is private.
    const extra = kind === 'shop' ? 6 : kind === 'museum' ? 4 : 2;
    const { size, minSize } = anchorLotSize(members, extra);
    regions.push({
      id: kind,
      kind,
      anchors: members.map((m) => m.id),
      size, minSize,
      tags: kind === 'own-house' ? ['dwelling'] : kind === 'shop' ? ['shop'] : ['quiet'],
    });
  }
  return regions;
}

function themeRegions(rng: Rng, richness: number): RegionSpec[] {
  const r = clamp01(richness);
  const pool = THEME_LIBRARY.filter((t) => (t.minRichness ?? 0) <= r);
  const picked = drawThemes(rng, pool, themeCount(r));
  return picked.map((t, i) => ({
    id: `theme-${i}`,
    kind: 'theme' as const,
    themeId: t.id,
    family: t.family,
    anchors: [],
    size: { ...t.size },
    tags: t.tags,
  }));
}

/** Weighted draw WITHOUT replacement (the library is larger than any count, so a map never repeats
 *  a theme), then the companion guarantee: a case can only be honoured if both its halves exist, so
 *  a drink region drags a greenery region in and the shop's complex drags a library in. The pairing
 *  is still the sampler's to arrange — this only makes it arrangeable. */
function drawThemes(rng: Rng, pool: readonly ThemeSpec[], count: number): ThemeSpec[] {
  const remaining = [...pool];
  const picked: ThemeSpec[] = [];
  for (let k = 0; k < count && remaining.length > 0; k++) {
    let total = 0;
    for (const t of remaining) total += t.weight;
    let roll = rng.float() * total;
    let idx = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      roll -= remaining[j]!.weight;
      if (roll <= 0) { idx = j; break; }
    }
    picked.push(remaining.splice(idx, 1)[0]!);
  }
  // A cafe wants a park beside it; the shop wants a library above it, and the shop is an ANCHOR, so
  // that want is unconditional.
  ensureCompanion(picked, remaining, picked.some((t) => t.tags.includes('drink')), 'greenery');
  ensureCompanion(picked, remaining, true, 'library');
  return picked;
}

/** If `wanted` and no picked theme carries `partner`, swap the least-weighted tagless pick for the
 *  heaviest available partner (or append it, where every pick is already spoken for). A theme gated
 *  by richness is never the victim: it is a set piece, not filler. */
function ensureCompanion(
  picked: ThemeSpec[], remaining: ThemeSpec[], wanted: boolean, partner: AffinityTag,
): void {
  if (!wanted || picked.some((t) => t.tags.includes(partner))) return;
  const candidate = remaining
    .filter((t) => t.tags.includes(partner))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0];
  if (!candidate) return;
  const victim = picked
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.tags.length === 0 && t.minRichness === undefined)
    .sort((a, b) => a.t.weight - b.t.weight || a.t.id.localeCompare(b.t.id))[0];
  if (victim) {
    remaining.push(victim.t);
    picked[victim.i] = candidate;
  } else {
    picked.push(candidate);
  }
  const at = remaining.indexOf(candidate);
  if (at >= 0) remaining.splice(at, 1);
}

/** Fisher-Yates against the seeded rng: a copy, never the caller's array. */
function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!; a[i] = a[j]!; a[j] = t;
  }
  return a;
}
