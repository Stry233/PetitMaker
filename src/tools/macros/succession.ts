/**
 * Succession: what a HELD planting turns into while the hand stays down.
 *
 * THE HOLD IS TIME. A press plants a young community (`habitat.ts`); each burst the spray fires at
 * the same spot advances the stand one succession STEP, and the step is a geometric one — a plant's
 * maturity is `stage` minus how many rings out from the press centre it stands, so the heart of the
 * stand ages first and the rim keeps its pioneers. Three tiers is the whole ladder (pioneer, mid,
 * climax) and the stage is clamped to it: past the third burst the shape of the stand is settled and
 * later bursts only fill it in, which is what makes the gradient stable for a hold of any length.
 *
 * AN UPGRADE IS WITHIN ONE CATEGORY. A tree matures into another tree and a flower into another
 * flower, never across, so the tree-led card's stand stays a stand of trees with a flora floor under
 * it (each card's per-category promise holds by construction, not by re-measurement) and the flora-led
 * card's climax is a showpiece bloom rather than a tree. The grand specimen is the LEAD category's,
 * for the same reason.
 *
 * NOTHING HAPPENS AT STAGE 1. A short press is exactly the community `habitat.ts` builds, untouched
 * — the ladder is what the hold buys, and a tool that rewrote the first press's species would make
 * a click and the first frame of a hold two different plantings.
 *
 * A HOLD AGES ONLY WHAT IT PLANTED. `ageStand` grows the ids `patch.ts` names in its `holdIds`
 * argument — this hold's own bursts, never the whole disc — because a press that rewrites what
 * stood before it is destruction wearing growth's name: a hand-placed flower or an earlier, unrelated
 * press's stand must survive a hold that happens to land beside it. The hold still grows a stand of
 * its own; it just never reaches past its own planting to do it.
 */
import { ItemCategory, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { categoryOf, getPlaceableByCategory } from '../../state/catalog';
import { makeCtx, tryPlace } from '../placement/object';
import type { SpeciesPicker } from '../placement/nature';
import { objectPlacementCommand, removeObjectCommand } from '../objects/object-placer';
import type { MacroContext } from './context';
import { buildCommunity, type HabitatField } from './habitat';

/** The oldest a stand gets, and the number of tiers in every palette's table. */
export const CLIMAX_STAGE = 3;

/** Separates one maturity tier's community draw from the next's, so the young ring and the old one
 *  are not the same species list re-sorted. */
const TIER_SALT = 0x27d4eb2f;

/** One palette's ladder: the species that read as each maturity tier, youngest tier first, plus the
 *  one specimen that stands at the oldest centre once the stand reaches climax. Keys are SPECIES
 *  prefixes, matched longest-first exactly as `habitat.ts` matches its preference rows, so a
 *  colourway inherits its species' tier. */
export interface SuccessionPalette {
  tiers: readonly (readonly string[])[];
  grand: string;
}

/**
 * What each category's plants grow into.
 *
 * A garden designer's opinion, like `SPECIES_HABITAT` beside it: what reads as young ground cover,
 * what reads as an establishing thicket, and what reads as old growth. The tree ladder runs from the
 * quick light species to the ones that take a lifetime; the flora ladder runs from ground flowers
 * through clumps and shrubs to the showpiece blooms, and its grand specimen is a bloom — a flora-led
 * press must never produce a tree.
 */
const SUCCESSION: Partial<Record<ItemCategory, SuccessionPalette>> = {
  [ItemCategory.Tree]: {
    tiers: [
      ['tree-bamboo', 'tree-flame', 'tree-peach', 'tree-plum'],
      ['tree-apple', 'tree-mango', 'tree-avocado', 'tree-cactus'],
      ['tree-fir', 'tree-ginkgo', 'tree-baobab', 'tree-dragonblood'],
    ],
    grand: 'tree-baobab',
  },
  [ItemCategory.Flora]: {
    tiers: [
      ['flower-daisy', 'flower-violet', 'flower-portulaca', 'flower-bellflower', 'flower-lily'],
      ['shrub', 'plant-azalea', 'plant-gardenia', 'plant-agave', 'flower-rose', 'flower-agapanthus'],
      ['flower-protea', 'flower-sunflower', 'flower-dahlia', 'flower-canna', 'flower-amaryllis'],
    ],
    grand: 'flower-protea',
  },
};

/** The palette a category grows by, or null for the categories a planting never lays. */
export function successionPalette(category: ItemCategory | undefined): SuccessionPalette | null {
  return (category && SUCCESSION[category]) ?? null;
}

/** Every species prefix in a palette, longest first — so `flower-lily-cyan` resolves through
 *  `flower-lily` and a colourway could still be given a tier of its own later. */
const keysOf = (p: SuccessionPalette): { key: string; tier: number }[] => p.tiers
  .flatMap((ids, t) => ids.map((key) => ({ key, tier: t + 1 })))
  .sort((a, b) => b.key.length - a.key.length);
const paletteKeys = new Map<SuccessionPalette, { key: string; tier: number }[]>();

/** Which tier a standing plant already reads as, or null for a species the table does not name. A
 *  caller treats an unnamed species as a pioneer — the tier an upgrade always moves away from —
 *  rather than as something to leave alone. */
export function tierOf(catalogId: string, palette: SuccessionPalette): number | null {
  let keys = paletteKeys.get(palette);
  if (!keys) { keys = keysOf(palette); paletteKeys.set(palette, keys); }
  return keys.find((k) => catalogId.startsWith(k.key))?.tier ?? null;
}

/**
 * The maturity a plant `d` cells from the press centre has reached after `stage` bursts.
 *
 * Age falls off from the centre by one tier per ring, which is what puts old growth at the heart and
 * pioneers at the rim. The stage is clamped first: a hold longer than the ladder freezes the pattern
 * instead of marching climax out to the edge.
 */
export function tierAt(stage: number, d: number, ringWidth: number): number {
  const s = Math.min(Math.max(stage, 1), CLIMAX_STAGE);
  const rings = Math.floor(d / Math.max(ringWidth, 1e-6));
  return Math.min(Math.max(s - rings, 1), CLIMAX_STAGE);
}

/** The catalog ids of one category that read as one tier, MINUS the grand specimen: a stand has one
 *  of those or none, so the species that marks it must never be handed out by the ordinary draw.
 *  Empty only if the table and the catalog have drifted apart, which `succession.test.ts` fails the
 *  build on. */
function tierPool(category: ItemCategory, palette: SuccessionPalette, tier: number): string[] {
  return getPlaceableByCategory(category)
    .map((i) => i.id)
    .filter((id) => !id.startsWith(palette.grand) && (tierOf(id, palette) ?? 1) === tier);
}

/** Every plant standing in `cells`, grown by THIS hold (`holdIds`) and known to a succession
 *  palette. Exported so a caller can find out whether there is anything to age BEFORE paying for
 *  the habitat field the ageing reads. */
export function ageable(state: GridState, cells: readonly MacroCoord[], holdIds: ReadonlySet<string>): PlacedObject[] {
  const W = state.template.width;
  const disc = new Set(cells.map((c) => c.y * W + c.x));
  return [...state.objects.values()]
    .filter((o) => holdIds.has(o.id) && disc.has(o.position.y * W + o.position.x) && successionPalette(categoryOf(o)));
}

export interface AgeInput {
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
  lead: ItemCategory;
  /** The ids THIS hold has planted and left standing — the ageing pass's allow-list. A plant in the
   *  disc whose id is not here is another press's or a person's, and stays untouched. */
  holdIds: ReadonlySet<string>;
}

/**
 * Age every plant standing in the disc to the tier its distance from the centre has earned.
 *
 * AN UPGRADE IS A REMOVE PLUS A PLACE, like a rotation: the executor is the caller's (a scratch
 * clone during a macro build), so both land inside the one stroke group and the whole hold still
 * folds to a single undo entry. A plant already at its tier is left alone, which is what keeps a
 * long hold from churning every species on every burst; a replacement the rules refuse is followed
 * by a re-place of the original, which is the same command that put it there a moment ago.
 *
 * It ages only `input.holdIds`: this hold's own stand, never a plant another press or a person left
 * standing in the same disc. The disc still bounds it.
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
  // ONE grand specimen, and only once the stand is old: the lead-category plant nearest the centre.
  // It must stand in the CLIMAX ring itself — with the inner rings unplantable (a press at a pond
  // edge), the nearest plant can be out among the rim pioneers, and a lone showpiece there reads as
  // a stray rather than as the heart of anything.
  const nearest = input.stage >= CLIMAX_STAGE
    ? standing.filter((o) => categoryOf(o) === input.lead).sort((a, b) => dist(a) - dist(b))[0]
    : undefined;
  const grandAt = nearest && tierAt(input.stage, dist(nearest), input.ringWidth) === CLIMAX_STAGE
    ? nearest : undefined;

  // The COMMUNITY, per tier: `buildCommunity` is the habitat's species policy (a seed-derived dominant
  // over most of the stand, habitat-sorted accents through the rest), and handing it one tier's pool
  // gives that tier a dominant of its own. Drawing each replacement by habitat alone instead would
  // quietly diversify a near-monoculture press into a catalog sample as it aged — a stand has to
  // stay a stand OF something at every age.
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
    let want: string;
    if (obj === grandAt) want = SUCCESSION[input.lead]!.grand;
    // Already the age it should be — and not wearing the grand species, which the stage-1 community
    // can hand out like any other and only the ONE specimen above may keep.
    else if ((tierOf(obj.catalogId, palette) ?? 1) === tier && !obj.catalogId.startsWith(palette.grand)) continue;
    else {
      const pool = tierPool(category, palette, tier);
      if (pool.length === 0) continue;
      want = communityFor(tier)(category, pool, obj.position.x, obj.position.y, obj.position.y * W + obj.position.x);
    }
    if (want === obj.catalogId) continue;

    const original: PlacedObject = { ...obj, position: { ...obj.position } };
    if (!executor.execute(removeObjectCommand(obj)).success) continue;
    if (!tryPlace(place, want, obj.position.x, obj.position.y, obj.rotation)) {
      executor.execute(objectPlacementCommand(original));
    }
  }
}
