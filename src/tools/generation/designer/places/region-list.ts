/** Catalog anchors and seeded theme regions are sized before the layout stage places them. */
import { GENERATION_STYLE } from '../../../../config/generation-style';
import type { CatalogItem } from '../../../../core/model/types';
import { makeRng, shuffled, weightedIndex, type Rng } from '../../../../core/base/rng';
import { clamp01 } from '../../../../core/base/math';
import { getPlaceableByRole, itemRole } from '../../../../state/catalog';
import type { AffinityTag, AnchorKind, RegionSpec } from '../types';
import { ANCHOR_KINDS, THEME_LIBRARY, themeRef, type ThemeSpec } from '../themes';

const ROLE_BY_ID = new Map<string, AnchorKind>(GENERATION_STYLE.anchorRoles.map(r => [r.id, r.role]));

/** The anchor region an item belongs to. Unknown ids fall back by role, a new home to a dwelling and
 *  anything else to a shop, so the hard rule cannot be broken by adding an item. */
function anchorRoleOf(item: CatalogItem): AnchorKind {
  return ROLE_BY_ID.get(item.id) ?? (itemRole(item) === 'home' ? 'residential' : 'shop');
}

/** Every item a plan must find a home for: the placeable homes and amenities, in catalog order. A
 *  finished planet stands every one of them. */
export function anchorCatalogItems(): CatalogItem[] {
  return [
    ...getPlaceableByRole('home'),
    ...getPlaceableByRole('amenity'),
  ];
}

// --- counts ------------------------------------------------------------------------------------

/** Theme-region count at richness 0 and 1. With about 6 anchor regions the plan holds 12 to 24 lots,
 *  the coarse band a planet's places subdivide from. */
const THEME_COUNT = { min: 6, max: 18 } as const;

/** How many pure theme regions a map of this richness holds. Monotone in richness by construction
 *  (a rounded affine map), which is what the richness probe pins. */
function themeCount(richness: number): number {
  const r = clamp01(richness);
  return Math.round(THEME_COUNT.min + (THEME_COUNT.max - THEME_COUNT.min) * r);
}


// --- anchor lot sizing ---------------------------------------------------------------------------

/** Room a home needs beside its neighbours: the gate strip is 3 wide and 2 deep
 *  (`placement/object.ts:buildingGate`), plus the 1-cell street margin the populator keeps. */
const HOME_PAD = { x: 2, y: 3 };
/** Border inside a lot, so a building never sits on the lot's own edge. */
const LOT_BORDER = 2;

/** The lot an anchor region wants and the floor it may shrink to. `extra` is the composition
 *  allowance that anchor's own case implies; the floor drops it and keeps only what the buildings
 *  themselves need, since placing them is the hard rule.
 *
 *  Rotation is the layout's to choose (the door must face the entry), so a building is budgeted at
 *  its longest side in both axes, since a quarter turn swaps its width and depth. */
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
    // roomy ones; placing every building is the hard rule, so the last resort is
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
  richness = 0.5,
  catalog: readonly CatalogItem[] = anchorCatalogItems(),
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

  // Every home is its own region. A planet stands its buildings 13 to 70 cells from the plaza, each
  // with its own composition around it and a different neighbourhood at every one, so a region per
  // home is what gives each its own garden and lets the layout spread them across the planet.
  // Gathering them into clusters of two to four is a fair reading of the residential district, and
  // it puts most of a map's houses in one block.
  const homes = shuffled(rng, byRole.get('residential') ?? []);
  byRole.delete('residential');
  for (const home of homes) {
    const { size, minSize } = anchorLotSize([home], ANCHOR_KINDS.residential.lotMargin);
    regions.push({
      id: `res-${regions.length}`,
      kind: 'residential',
      anchors: [home.id],
      size, minSize,
      tags: ANCHOR_KINDS.residential.tags,
    });
  }

  // The remaining anchor kinds, one region each, in the library's order so a plan reads the same way.
  for (const kind of (Object.keys(ANCHOR_KINDS) as AnchorKind[]).filter((k) => k !== 'residential')) {
    const members = byRole.get(kind) ?? [];
    if (members.length === 0) continue;
    const { size, minSize } = anchorLotSize(members, ANCHOR_KINDS[kind].lotMargin);
    regions.push({
      id: kind,
      kind,
      anchors: members.map((m) => m.id),
      size, minSize,
      tags: ANCHOR_KINDS[kind].tags,
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
    ...themeRef(t.id),
    anchors: [],
    size: { ...t.size },
    tags: t.tags,
  }));
}

/** Weighted draw without replacement (the library is larger than any count, so a map never repeats
 *  a theme), then the companion guarantee: a case can only be honoured if both its halves exist, so
 *  a drink region drags a greenery region in and the shop's complex drags a library in. The pairing
 *  is still the sampler's to arrange — this only makes it arrangeable. */
function drawThemes(rng: Rng, pool: readonly ThemeSpec[], count: number): ThemeSpec[] {
  const remaining = [...pool];
  const picked: ThemeSpec[] = [];
  for (let k = 0; k < count && remaining.length > 0; k++) {
    const idx = weightedIndex(rng, remaining.map((t) => t.weight));
    picked.push(remaining.splice(idx, 1)[0]!);
  }
  // A cafe wants a park beside it; the shop wants a library above it, and the shop is an anchor, so
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
