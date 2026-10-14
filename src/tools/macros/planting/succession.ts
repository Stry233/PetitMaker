/**
 * Succession: what a held planting turns into while the hand stays down. Each burst at the same spot
 * advances the stand one step, geometrically: a plant's maturity is `stage` minus its rings from the
 * press centre, so the heart ages first and the rim keeps its pioneers. Three tiers (pioneer, mid,
 * climax) and the stage is clamped to them, so the gradient is stable for a hold of any length.
 *
 * An upgrade stays within its category (a tree into a tree, a flower into a flower), so each card's
 * per-category promise holds by construction, and the grand specimen is the lead category's. Stage
 * 1 is exactly `habitat.ts`'s community, so a click and a hold's first frame plant the same thing.
 *
 * A hold ages only what it planted (`patch.ts`'s `holdIds`): a hand-placed flower or another press's
 * stand beside it survives.
 */
import { placeObjectCommand, removeObjectCommand } from '../../../core/model/command-build';
import type { CategoryId, GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import { catalogLoadValue, categoryOf, getCatalogItem, getPlaceableByCategory } from '../../../state/catalog';
import { PLANT_SPECIES, plantSpecies, type PlantSpecies } from '../../../config/catalog/plant-species';
import { makeCtx, tryPlace } from '../../placement/object';
import type { SpeciesPicker } from './nature';
import type { MacroContext } from '../context';
import { buildCommunity, type HabitatField } from './habitat';

/** The oldest a stand gets, and the number of tiers in every palette's table. */
export const CLIMAX_STAGE = 3;

/** Separates one maturity tier's community draw from the next's, so the young ring and the old one
 *  are not the same species list re-sorted. */
const TIER_SALT = 0x27d4eb2f;

/** One category's ladder: the category, and the species that stands at the oldest centre once the
 *  stand reaches climax. Each species' maturity tier is its row in the plant species registry
 *  (`config/catalog/plant-species.ts`), read through the item's own `plant.species`, so every
 *  colourway of a species has its tier. The tree ladder runs from the quick light species to the ones
 *  that take a lifetime; the flora ladder runs from ground flowers through clumps and shrubs to the
 *  showpiece blooms, and its grand specimen is a bloom: a flora-led press must never produce a tree. */
interface SuccessionPalette {
  category: CategoryId;
  grand: string;
}

/** The categories a planting grows, each with its registry's climax species. */
const SUCCESSION: Partial<Record<CategoryId, SuccessionPalette>> = Object.fromEntries(
  PLANT_SPECIES.filter((s) => s.climax).map((s) => [s.category, { category: s.category, grand: s.id }]),
);

/** The palette a category grows by, or null for the categories a planting never lays. */
export function successionPalette(category: CategoryId | undefined): SuccessionPalette | null {
  return (category ? SUCCESSION[category] : undefined) ?? null;
}

/** The species row an item belongs to, when it names one the registry carries. */
const speciesOfItem = (catalogId: string): PlantSpecies | undefined => {
  const species = getCatalogItem(catalogId)?.plant?.species;
  return species === undefined ? undefined : plantSpecies(species);
};

/** Whether an item is a colourway of its palette's grand species. */
export function isGrand(catalogId: string, palette: SuccessionPalette): boolean {
  return getCatalogItem(catalogId)?.plant?.species === palette.grand;
}

/** Which tier a standing plant already reads as, or null for a species the palette's category does
 *  not grow. A caller treats an unnamed species as a pioneer — the tier an upgrade always moves away
 *  from — rather than as something to leave alone. */
export function tierOf(catalogId: string, palette: SuccessionPalette): number | null {
  const species = speciesOfItem(catalogId);
  return species && species.category === palette.category ? species.tier : null;
}

/**
 * The maturity a plant `d` cells from the press centre has reached after `stage` bursts.
 *
 * Age falls off from the centre by one tier per ring, which is what puts old growth at the heart and
 * pioneers at the rim. The stage is clamped first: a hold longer than the ladder freezes the pattern
 * instead of marching climax out to the edge.
 */
function tierAt(stage: number, d: number, ringWidth: number): number {
  const s = Math.min(Math.max(stage, 1), CLIMAX_STAGE);
  const rings = Math.floor(d / Math.max(ringWidth, 1e-6));
  return Math.min(Math.max(s - rings, 1), CLIMAX_STAGE);
}

/** The catalog ids of one category that read as one tier, minus the grand specimen: a stand has one
 *  of those or none, so the species that marks it must never be handed out by the ordinary draw.
 *  Empty only if the table and the catalog have drifted apart, which `succession.test.ts` fails the
 *  build on. */
function tierPool(category: CategoryId, palette: SuccessionPalette, tier: number): string[] {
  return getPlaceableByCategory(category)
    .map((i) => i.id)
    .filter((id) => !isGrand(id, palette) && (tierOf(id, palette) ?? 1) === tier);
}

/** Every plant standing in `cells`, grown by this hold (`holdIds`) and known to a succession
 *  palette. Exported so a caller can find out whether there is anything to age before paying for
 *  the habitat field the ageing reads. */
export function ageable(state: GridState, cells: readonly MacroCoord[], holdIds: ReadonlySet<string>): PlacedObject[] {
  const W = state.template.width;
  const disc = new Set(cells.map((c) => c.y * W + c.x));
  return [...state.objects.values()]
    .filter((o) => holdIds.has(o.id) && disc.has(o.position.y * W + o.position.x) && successionPalette(categoryOf(o)));
}

interface AgeInput {
  /** The disc the press works over — a plant outside it is another stand's business. */
  cells: readonly MacroCoord[];
  /** The press's own aim point, in cells. */
  centre: { x: number; y: number };
  /** How far out one tier of age reaches. */
  ringWidth: number;
  /** How many bursts have landed at this spot. 1 does nothing. */
  stage: number;
  field: HabitatField;
  seed: number;
  /** The card's own category: whose grand specimen stands at the centre. */
  lead: CategoryId;
  /** The ids this hold has planted and left standing — the ageing pass's allow-list. A plant in the
   *  disc whose id is not here is another press's or a person's, and stays untouched. */
  holdIds: ReadonlySet<string>;
}

/**
 * Age every plant of this hold (`input.holdIds`) standing in the disc to the tier its distance from
 * the centre has earned. An upgrade is a remove plus a place on the caller's executor, so the whole
 * hold folds to one undo entry. A plant already at its tier is left alone; a refused replacement is
 * followed by re-placing the original, except a stray grand specimen, which never returns so the
 * grand stays one per stand.
 */
export function ageStand(ctx: MacroContext, input: AgeInput): void {
  if (input.stage <= 1) return;
  const { state, executor, registry } = ctx;
  const W = state.template.width;

  // Deterministic order, and never by object id: an id is minted from `Date.now()`/`Math.random()`,
  // so ordering by one would age a different plant first on a second run of the same seed.
  const standing = ageable(state, input.cells, input.holdIds)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x
      || a.catalogId.localeCompare(b.catalogId));
  if (standing.length === 0) return;

  const dist = (o: PlacedObject): number => Math.hypot(o.position.x - input.centre.x, o.position.y - input.centre.y);
  // One grand specimen, and only once the stand is old: the lead-category plant nearest the centre.
  // It must stand in the climax ring itself — with the inner rings unplantable (a press at a pond
  // edge), the nearest plant can be out among the rim pioneers, and a lone showpiece there reads as
  // a stray rather than as the heart of anything.
  const nearest = input.stage >= CLIMAX_STAGE
    ? standing.filter((o) => categoryOf(o) === input.lead).sort((a, b) => dist(a) - dist(b))[0]
    : undefined;
  const grandAt = nearest && tierAt(input.stage, dist(nearest), input.ringWidth) === CLIMAX_STAGE
    ? nearest : undefined;

  // The community, per tier: `buildCommunity` is the habitat's species policy (a seed-derived dominant
  // over most of the stand, habitat-sorted accents through the rest), and handing it one tier's pool
  // gives that tier a dominant of its own. Drawing each replacement by habitat alone instead would
  // quietly diversify a near-monoculture press into a catalog sample as it aged — a stand has to
  // stay a stand of something at every age.
  const communities = new Map<number, SpeciesPicker>();
  const centreIndex = Math.round(input.centre.y) * W + Math.round(input.centre.x);
  const communityFor = (tier: number): SpeciesPicker => {
    let picker = communities.get(tier);
    if (!picker) {
      picker = buildCommunity(input.field, centreIndex, (input.seed ^ Math.imul(tier, TIER_SALT)) >>> 0);
      communities.set(tier, picker);
    }
    return picker;
  };

  const place = makeCtx(state, (c) => executor.execute(c), registry, input.seed);
  for (const obj of standing) {
    const category = categoryOf(obj)!;
    const palette = successionPalette(category)!;
    const tier = tierAt(input.stage, dist(obj), input.ringWidth);
    // The stage-1 community can hand the grand species out like any other; only the one specimen
    // above may keep it.
    const shed = obj !== grandAt && isGrand(obj.catalogId, palette);
    let want: string;
    let pool: string[] = [];
    if (obj === grandAt) want = SUCCESSION[input.lead]!.grand;
    // Already the age it should be.
    else if ((tierOf(obj.catalogId, palette) ?? 1) === tier && !shed) continue;
    else {
      pool = tierPool(category, palette, tier);
      if (pool.length === 0) continue;
      want = communityFor(tier)(category, pool, obj.position.x, obj.position.y, obj.position.y * W + obj.position.x);
    }
    if (want === obj.catalogId) continue;

    const original: PlacedObject = { ...obj, position: { ...obj.position } };
    if (!executor.execute(removeObjectCommand(obj)).success) continue;
    if (tryPlace(place, want, obj.position.x, obj.position.y, obj.rotation)) continue;
    if (!shed) {
      executor.execute(placeObjectCommand(original));
      continue;
    }
    // A plant that must shed the grand species and whose drawn replacement the rules refuse (a full
    // region refuses a heavier species) takes the lightest one of its tier that fits, or leaves.
    const fallbacks = pool.filter((id) => id !== want)
      .sort((a, b) => catalogLoadValue(a) - catalogLoadValue(b) || a.localeCompare(b));
    for (const id of fallbacks) if (tryPlace(place, id, obj.position.x, obj.position.y, obj.rotation)) break;
  }
}
