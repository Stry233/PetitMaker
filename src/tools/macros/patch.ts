/**
 * `patch`: the populator's layered ecology (forest stands with glades, biome bands, ecotone drifts)
 * run over a bounded part of a live map.
 *
 * The bound is the ANALYSIS, not a radius. `placeNature` walks noise fields over `analysis.open`
 * and has no extent of its own, so confining the placeable mask is what confines the planting.
 *
 * The body runs INSIDE the caller's stroke group and pushes no provenance of its own. Its two
 * callers commit differently on purpose: `applyMacro` attributes the planting to the generator,
 * the agent's `plant_forest` attributes it to the model that asked for it.
 */
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { getCell } from '../../core/model/grid-model';
import { ItemCategory, TerrainType, type MacroCoord } from '../../core/model/types';
import { analyzeTerrain } from '../generation/placement/analysis';
import { placeNature } from '../generation/placement/nature';
import { makeCtx } from '../generation/placement/object';
import { removeObjectCommand } from '../objects/object-placer';
import type { MacroContext } from './context';
import { layDelight } from './delights';
import { layGrammar, readGrammar } from './grammar';
import { buildCommunity, buildHabitatField } from './habitat';
import { objectsChanged } from './measure';
import { ageable, ageStand, CLIMAX_STAGE } from './succession';

export interface PatchInput {
  /** The cells the planting is confined to, or null for the whole map. */
  cells: MacroCoord[] | null;
  /** 0..1, the ecology's own `nature` knob. 0 plants nothing. */
  density: number;
  seed: number;
  /** Tree, Flora, or both when omitted. */
  categories?: readonly ItemCategory[];
  /** How many bursts of a HELD press have landed at this spot: the stand's age (see
   *  `succession.ts`). 1, or absent, is a short press and ages nothing. */
  stage?: number;
  /** The disc's radius in cells — what the age rings are measured against. The disc's own extent
   *  when absent. */
  radius?: number;
  /** The seed of the FIRST burst of the hold this press belongs to, when it is one. A COMPOSITION
   *  (a grammar bed, a delight) is drawn from it rather than from `seed`, so every burst of one hold
   *  lays the same one; `seed` itself when absent, which is what a short press is. */
  anchorSeed?: number;
  /** The ids every EARLIER burst of THIS hold planted and left standing — the ageing pass's
   *  allow-list (see `ageScopedStand`), so a burst grows only the stand its own hold raised and
   *  never a hand-placed plant or an earlier, unrelated press's. Absent on a short press, which
   *  ages nothing regardless. */
  heldIds?: ReadonlySet<string>;
}

/** Plants a patch and returns how many objects it laid. Planting removes nothing, so the change
 *  count and the planted count are the same number here.
 *
 *  No habitat community: this is the agent's `plant_forest`, which plants a region or a whole map
 *  and has no press centre to choose one FOR (see `plantPatchTiers`). It keeps `placeNature`'s own
 *  climate bands. */
export function plantPatch(ctx: MacroContext, input: PatchInput): number {
  const { state, executor, registry } = ctx;
  const laid = objectsChanged(state);
  const analysis = analyzeTerrain(state, input.cells);
  const place = makeCtx(state, (c) => executor.execute(c), registry, input.seed);
  placeNature(place, analysis, input.density, new Set(), input.categories);
  return laid();
}

/** Draws a tier may take before it accepts that its ground will hold nothing. A category-scoped
 *  run (the flora-only card, or the tree-only mass pass) has fewer species competing for the same
 *  cells than an unrestricted one, so it clears the noise gates less often per draw and wants more
 *  of them before conceding. */
const TIER_DRAWS = 12;

/**
 * The planting a smart-build press runs: every elevation TIER of the disc planted as its own
 * confined ecology run.
 *
 * One run over a terraced slope starves — `analyzeTerrain` splits the tiers into narrow regions
 * and the stand noise's glades swallow a band two cells wide — so each tier gets its own run and
 * its own seed, which is what a hillside planted by hand looks like. The ANALYSIS is shared: it
 * is a whole-map scan and by far the run's dominant cost, so it is computed once for the disc and
 * each tier narrows a COPY of the open mask to its own cells. Water never buckets: nothing
 * plants on it.
 *
 * THE ECOLOGY DECIDES WHERE; THE COMMUNITY DECIDES WHAT. `placeNature`'s own stands, glades and
 * drifts still choose the cells, and the habitat field (`habitat.ts`) chooses the species that goes
 * in each: one seed-derived dominant over most of the stand, habitat-sorted accents through the
 * rest. The community is built ONCE per call, from the press seed and the disc's own centre, so a
 * disc spanning four terraces plants one community across all of them rather than four unrelated
 * ones — the tier loop below and its retries all share it.
 *
 * EACH TIER INSISTS ON AN ANSWER. A draw can put a glade exactly where the user pointed and plant
 * nothing on ground that would carry an orchard; taking the next draw is honest where reporting
 * that a lawn cannot be planted is not, and the user's own seed still decides which draw lands, so
 * two presses are still two different plantings.
 */
export function plantPatchTiers(ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }): number {
  const { state, executor, registry } = ctx;
  const laid = objectsChanged(state);
  const analysis = analyzeTerrain(state, input.cells);
  const W = analysis.width;
  const community = buildCommunity(buildHabitatField(analysis), centreIndex(input.cells, W), input.seed);

  const tiers = new Map<number, MacroCoord[]>();
  for (const c of input.cells) {
    const t = getCell(state.cells, c.x, c.y)?.terrain;
    if (t?.type === TerrainType.Water) continue;
    const e = t ? surfaceElevation(t) : 0;
    const bucket = tiers.get(e);
    if (bucket) bucket.push(c);
    else tiers.set(e, [c]);
  }

  for (const [tier, tierCells] of [...tiers.entries()].sort(([a], [b]) => a - b)) {
    // The disc's own analysis, narrowed: open only where this tier's cells are.
    const open = new Uint8Array(analysis.open.length);
    for (const c of tierCells) {
      const i = c.y * W + c.x;
      open[i] = analysis.open[i]!;
    }
    const view = { ...analysis, open };
    for (let draw = 0; draw < TIER_DRAWS; draw++) {
      const before = state.objects.size;
      const seed = (input.seed + draw * 0x9e3779b1 + tier * 0x85ebca6b) >>> 0;
      const place = makeCtx(state, (c) => executor.execute(c), registry, seed);
      placeNature(place, view, input.density, new Set(), input.categories, community);
      if (state.objects.size > before) break;
    }
  }
  return laid();
}

/** The two category scopes the object shelf's smart-planting cards choose between: a
 *  TREE-led press plants a stand whose mass is trees, with a flora floor underneath (a grove has
 *  one); a FLORA-led press plants no trees at all. */
export type PatchScope = 'tree' | 'flora';

/** The flora-led card's own scope: a bare filter, category-only, passed to `placeNature`
 *  unchanged — a single run is all that scope ever needs. The tree-led card has no equivalent
 *  combined list: its mass and its floor are two SEPARATE single-category runs (see
 *  `plantScopedPatch`), coordinated afterwards rather than filtered together. */
const FLORA_SCOPE: readonly ItemCategory[] = [ItemCategory.Flora];

/** What fraction of the press's own density plants the flora floor under a tree-led stand: a stand
 *  must read as TREES at a glance, so the floor is an accent, never the mass — though a fraction is
 *  a target, not a guarantee (see `capFloorToMass` and `TREE_LED_FLORA_CAP_FRACTION`). */
const TREE_LED_FLORA_DENSITY = 0.15;

/** The hard ceiling on the floor pass's share of a tree-led press, whatever the density target and
 *  the two independent draws land on: `capFloorToMass` trims to whichever is smaller, this fraction
 *  of the mass or `mass - 1`, so an unlucky worst-case draw still reads as a grove and never as a
 *  flower bed with trees in it. */
const TREE_LED_FLORA_CAP_FRACTION = 0.25;

/** Salts the floor pass's seed away from the mass pass's, so the two are independent draws rather
 *  than the same noise field asked twice. */
const FLOOR_SEED_SALT = 0x51ed270b;

/** The disc's own centre, from the cells it was asked to plant rather than a second copy of the
 *  aim point: `circleCells` builds them symmetric around it, so the average IS the aim point
 *  wherever the map's edge hasn't clipped the disc. */
function centroid(cells: readonly MacroCoord[]): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  return { x: sx / cells.length, y: sy / cells.length };
}

/** The same centre as a flat index: the ground the press was AIMED at, which is the site the
 *  community is chosen for even though the disc reaches past it. */
function centreIndex(cells: readonly MacroCoord[], width: number): number {
  const { x, y } = centroid(cells);
  return Math.round(y) * width + Math.round(x);
}

/**
 * Keeps the floor pass's own flora strictly UNDER the mass pass's tree count, removing the excess
 * inside the SAME stroke so the whole press still folds to the caller's one undo entry.
 *
 * The two passes are independent draws over independent noise fields — nothing in `placeNature`
 * ties one's count to the other's, so a low-density floor pass can still outnumber a mass pass
 * that itself had a starved tier (a 300-seed sweep measured this at ~15% of presses). Scaling the
 * floor pass's density lower only shifts the odds; it cannot promise a count `placeNature` has no
 * notion of. So this runs the floor pass as planned and then TRIMS it, farthest from the press's
 * own centre first — the ground right under a stand is more clearly its floor than a lone bloom
 * planted near the disc's rim, so if anything is cut on a strict count it is the flora that reads
 * least like this stand's own accent. Ties (equal distance) are broken on position and species,
 * never on an object's id: an id is minted from `Date.now()`/`Math.random()` and is never
 * seed-derived, so ordering by it would make the SAME seed remove a different flower on a
 * different run.
 */
function capFloorToMass(
  ctx: MacroContext, cells: readonly MacroCoord[], plantedBefore: ReadonlySet<string>, cap: number,
): void {
  const added = [...ctx.state.objects.entries()].filter(([id]) => !plantedBefore.has(id));
  if (added.length <= cap) return;
  const { x: cx, y: cy } = centroid(cells);
  const byFarthestFirst = added
    .map(([, obj]) => ({ obj, d2: (obj.position.x - cx) ** 2 + (obj.position.y - cy) ** 2 }))
    .sort((a, b) => (
      b.d2 - a.d2 || a.obj.position.y - b.obj.position.y
      || a.obj.position.x - b.obj.position.x || a.obj.catalogId.localeCompare(b.obj.catalogId)
    ));
  for (let i = 0; i < added.length - cap; i++) ctx.executor.execute(removeObjectCommand(byFarthestFirst[i]!.obj));
}

/**
 * `plantPatchTiers`, scoped to one of the shelf's two cards.
 *
 * A FLORA scope is a single filtered run — `placeNature` already skips its tree branch outright
 * when `trees.length` is zero, so no species picker ever sees a tree id. A TREE scope is NOT one
 * run filtered to both categories: `plantPatchTiers`'s per-tier retry (`TIER_DRAWS`) stops at its
 * FIRST successful draw, and a lucky flora hit can end a tier's draws before any tree lands — the
 * "dominant" species would then be whichever the noise happened to place first, not a policy. So
 * a tree-led press runs the tree MASS on its own (its retries answer only to itself) and then a
 * decoupled, lower-density flora FLOOR pass for the accent a grove's ground wants — capped
 * afterwards (`capFloorToMass`) so trees stay strictly the majority whatever the two draws land.
 *
 * No trees at all means no floor either: a flora floor with nothing over it is not a floor, it is
 * the whole planting, which is what the flora-led card already is for — and skipping the second
 * pass here is also what keeps a starved press cheap rather than a wasted `TIER_DRAWS` budget.
 *
 * A HELD press then AGES what stands (`input.stage` > 1, see `succession.ts`): every burst plants as
 * above and then advances the stand's maturity one ring, so the disc fills outward while its heart
 * grows old. The ageing runs whatever the planting did — a burst over ground already full plants
 * nothing new and still grows what is there.
 *
 * ALL OF THAT IS THE WILD PRESS, and it is the third thing this function considers. What the press
 * is BESIDE comes first (`grammar.ts`: a bed around a building, a border along a road), then the
 * rare set piece (`delights.ts`). Both are COMPOSITIONS and neither ages: a design that matured into
 * a wood would be a different design, so a hold over one lays it again — refused cell by cell where
 * it already stands — instead of climbing the succession ladder. Only the wild stand grows.
 */
export function plantScopedPatch(
  ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }, scope: PatchScope,
): void {
  const lead = scope === 'tree' ? ItemCategory.Tree : ItemCategory.Flora;
  const centre = centroid(input.cells);
  // A composition is the HOLD's, not the burst's: drawn from the anchor seed, so every burst of one
  // hold reaches the same answer and the second one has nothing left to add.
  const composition = input.anchorSeed ?? input.seed;

  const site = readGrammar(ctx.state, input.cells, centre);
  if (site) {
    layGrammar(ctx, { site, cells: input.cells, centre, lead, seed: composition });
    return;
  }
  const delighted = layDelight(ctx, {
    cells: input.cells, centre, radius: input.radius ?? discExtent(input.cells, centre),
    seed: composition, lead, stage: input.stage ?? 1,
  });
  if (delighted !== null) return;

  // What THIS burst plants is part of the hold's own stand too (an ageable burst can land beside a
  // plant its own mass/floor pass just placed a moment earlier), so it joins `input.heldIds` as the
  // ageing pass's allow-list — never the full disc, which is everyone else's ground as well as this
  // hold's.
  const beforeThisBurst = new Set(ctx.state.objects.keys());
  if (scope === 'flora') plantPatchTiers(ctx, { ...input, categories: FLORA_SCOPE });
  else plantTreeLed(ctx, input);
  const plantedThisBurst = [...ctx.state.objects.keys()].filter((id) => !beforeThisBurst.has(id));
  const holdIds = new Set([...(input.heldIds ?? []), ...plantedThisBurst]);
  ageScopedStand(ctx, input, scope, holdIds);
}

function plantTreeLed(ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }): void {
  const mass = plantPatchTiers(ctx, { ...input, categories: [ItemCategory.Tree] });
  if (mass === 0) return;

  const plantedBeforeFloor = new Set(ctx.state.objects.keys());
  plantPatchTiers(ctx, {
    ...input,
    categories: [ItemCategory.Flora],
    density: input.density * TREE_LED_FLORA_DENSITY,
    seed: (input.seed + FLOOR_SEED_SALT) >>> 0,
  });
  const cap = Math.min(mass - 1, Math.floor(mass * TREE_LED_FLORA_CAP_FRACTION));
  capFloorToMass(ctx, input.cells, plantedBeforeFloor, cap);
}

/**
 * The hold's own half of the press: age one succession step (`ageStand`) whatever `holdIds` names —
 * this hold's own stand, never the whole disc (see `succession.ts`'s header on why).
 *
 * Skipped at stage 1 and where `holdIds` names nothing standing, so a short press costs exactly
 * what it cost before — which matters, because the ladder wants a habitat field and the field wants
 * an ANALYSIS of its own. The planting passes above each build one, and neither can be shared with
 * this: they run before their own plantings and the field must be read after all of them, since a
 * burst ages what the same burst has just planted. It is a whole-map scan on hold bursts only, and a
 * hold burst is already a whole macro run off the main thread.
 */
function ageScopedStand(
  ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }, scope: PatchScope, holdIds: ReadonlySet<string>,
): void {
  const stage = input.stage ?? 1;
  if (stage <= 1 || ageable(ctx.state, input.cells, holdIds).length === 0) return;
  const centre = centroid(input.cells);
  const field = buildHabitatField(analyzeTerrain(ctx.state, input.cells));
  ageStand(ctx, {
    cells: input.cells,
    centre,
    ringWidth: Math.max(1, (input.radius ?? discExtent(input.cells, centre)) / CLIMAX_STAGE),
    stage,
    field,
    seed: input.seed,
    lead: scope === 'tree' ? ItemCategory.Tree : ItemCategory.Flora,
    holdIds,
  });
}

/** How far the disc actually reaches from its centre, for a caller that did not name a radius. */
function discExtent(cells: readonly MacroCoord[], centre: { x: number; y: number }): number {
  let far = 0;
  for (const c of cells) far = Math.max(far, Math.hypot(c.x - centre.x, c.y - centre.y));
  return far;
}
