/**
 * `patch`: the populator's layered ecology (forest stands with glades, a habitat-sorted community, ecotone drifts)
 * run over a bounded part of a live map.
 *
 * The bound is the analysis, not a radius. `placeNature` walks noise fields over `analysis.open`
 * and has no extent of its own, so confining the placeable mask is what confines the planting.
 *
 * The body runs inside the caller's stroke group and pushes no provenance of its own. Its two
 * callers commit differently: `applyMacro` attributes the planting to the generator,
 * the agent's `plant_forest` attributes it to the model that asked for it.
 */
import { removeObjectCommand } from '../../../core/model/command-build';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { getCell } from '../../../core/model/grid-model';
import { cellsBounds } from '../../../core/grid/rect';
import { TerrainType, type MacroCoord } from '../../../core/model/types';
import type { CategoryRole } from '../../../core/model/traits';
import { categoryWithRole } from '../../../state/catalog';
import { analyzeTerrain } from '../../placement/analysis';
import { placeNature } from './nature';
import { makeCtx } from '../../placement/object';
import type { MacroContext } from '../context';
import { layDelight } from './delights';
import { layGrammar, readGrammar } from './grammar';
import { buildAreaCommunity, buildCommunity, buildHabitatField } from './habitat';
import { objectsChanged } from '../runtime/measure';
import { ageable, ageStand, CLIMAX_STAGE } from './succession';

interface PatchInput {
  /** The cells the planting is confined to, or null for the whole map. */
  cells: MacroCoord[] | null;
  /** 0..1, the ecology's own `nature` knob. 0 plants nothing. */
  density: number;
  seed: number;
  /** The plant roles planted, canopy and groundcover when omitted. */
  roles?: readonly CategoryRole[];
  /** How many bursts of a held press have landed at this spot: the stand's age (see
   *  `succession.ts`). 1, or absent, is a short press and ages nothing. */
  stage?: number;
  /** The disc's radius in cells — what the age rings are measured against. The disc's own extent
   *  when absent. */
  radius?: number;
  /** The seed of the first burst of the hold this press belongs to, when it is one. A composition
   *  (a grammar bed, a delight) is drawn from it rather than from `seed`, so every burst of one hold
   *  lays the same one; `seed` itself when absent, which is what a short press is. */
  anchorSeed?: number;
  /** The ids every earlier burst of this hold planted and left standing — the ageing pass's
   *  allow-list (see `ageScopedStand`), so a burst grows only the stand its own hold raised and
   *  never a hand-placed plant or an earlier, unrelated press's. Absent on a short press, which
   *  ages nothing regardless. */
  heldIds?: ReadonlySet<string>;
}

/** Plants a patch (the agent's `plant_forest`) and returns how many objects it laid. Planting
 *  removes nothing, so the change count and the planted count are the same number here. An area
 *  that fits one patch takes the community chosen for its centre, as a press does for its aim
 *  point (see `plantPatchTiers`); a larger one varies its community by patch (`buildAreaCommunity`). */
export function plantPatch(ctx: MacroContext, input: PatchInput): number {
  const { state, executor, registry } = ctx;
  const laid = objectsChanged(state);
  const analysis = analyzeTerrain(state, input.cells);
  const W = analysis.width;
  const centre = input.cells && input.cells.length > 0
    ? centreIndex(input.cells, W)
    : Math.floor(analysis.height / 2) * W + Math.floor(W / 2);
  const bounds = (input.cells && cellsBounds(input.cells)) ?? { x: 0, y: 0, w: W, h: analysis.height };
  const community = buildAreaCommunity(buildHabitatField(analysis), bounds, W, centre, input.seed);
  const place = makeCtx(state, (c) => executor.execute(c), registry, input.seed);
  placeNature(place, analysis, input.density, new Set(), { pick: community, roles: input.roles });
  return laid();
}

/** Draws a tier may take before it accepts that its ground will hold nothing. A category-scoped
 *  run (the flora-only card, or the tree-only mass pass) has fewer species competing for the same
 *  cells than an unrestricted one, so it clears the noise gates less often per draw and wants more
 *  of them before conceding. */
const TIER_DRAWS = 12;

/**
 * Plants each elevation tier as a separate ecology run while sharing one terrain analysis and one
 * seed-derived community across the disc. Water is excluded. Empty randomized draws retry within a
 * bounded budget so narrow terrace bands are not mistaken for unplantable ground.
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
      placeNature(place, view, input.density, new Set(), { pick: community, roles: input.roles });
      if (state.objects.size > before) break;
    }
  }
  return laid();
}

/** What a planting card plants: a stand led by the `lead` role, with a lighter `floor` of another
 *  role beneath it when there is one (a grove has one; a flower press plants no trees at all). The
 *  mass and the floor are two separate single-role runs, coordinated afterwards (see
 *  `plantScopedPatch`). */
export interface Planting {
  readonly lead: CategoryRole;
  readonly floor?: CategoryRole;
}

/** What fraction of the press's own density plants the floor under a stand: a stand must read as
 *  its lead at a glance, so the floor is an accent, never the mass — though a fraction is
 *  a target, not a guarantee (see `capFloorToMass` and `FLOOR_CAP_FRACTION`). */
const FLOOR_DENSITY = 0.15;

/** The hard ceiling on the floor pass's share of a press with a floor, whatever the density target and
 *  the two independent draws land on: `capFloorToMass` trims to whichever is smaller, this fraction
 *  of the mass or `mass - 1`, so an unlucky worst-case draw still reads as a grove and never as a
 *  flower bed with trees in it. */
const FLOOR_CAP_FRACTION = 0.25;

/** Salts the floor pass's seed away from the mass pass's, so the two are independent draws rather
 *  than the same noise field asked twice. */
const FLOOR_SEED_SALT = 0x51ed270b;

/** The disc's own centre, from the cells it was asked to plant rather than a second copy of the
 *  aim point: `circleCells` builds them symmetric around it, so the average is the aim point
 *  wherever the map's edge hasn't clipped the disc. */
function centroid(cells: readonly MacroCoord[]): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  return { x: sx / cells.length, y: sy / cells.length };
}

/** The same centre as a flat index: the ground the press was aimed at, which is the site the
 *  community is chosen for even though the disc reaches past it. */
function centreIndex(cells: readonly MacroCoord[], width: number): number {
  const { x, y } = centroid(cells);
  return Math.round(y) * width + Math.round(x);
}

/**
 * Keeps the floor pass's flora strictly under the mass pass's tree count, trimming the excess inside
 * the same stroke so the press folds to one undo entry. The two passes draw over independent noise,
 * so no density setting can promise the count. Trimming goes farthest from the press centre first;
 * ties break on position and species, never on an id, which is not seed-derived and would make one
 * seed remove a different flower on another run.
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
 * Runs contextual compositions before wild planting. A planting without a floor is one filtered tier
 * run of its lead. One with a floor plants the lead's mass first, then a lower-density floor capped
 * below the mass count; without a mass, no floor is added. Held wild presses advance succession, while composed beds,
 * borders, and rare set pieces keep their authored form.
 */
export function plantScopedPatch(
  ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }, planting: Planting,
): void {
  const { lead } = planting;
  const centre = centroid(input.cells);
  // A composition is the hold's, not the burst's: drawn from the anchor seed, so every burst of one
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

  // What this burst plants is part of the hold's own stand too (an ageable burst can land beside a
  // plant its own mass/floor pass just placed a moment earlier), so it joins `input.heldIds` as the
  // ageing pass's allow-list — never the full disc, which is everyone else's ground as well as this
  // hold's.
  const beforeThisBurst = new Set(ctx.state.objects.keys());
  if (planting.floor === undefined) plantPatchTiers(ctx, { ...input, roles: [lead] });
  else plantWithFloor(ctx, input, lead, planting.floor);
  const plantedThisBurst = [...ctx.state.objects.keys()].filter((id) => !beforeThisBurst.has(id));
  const holdIds = new Set([...(input.heldIds ?? []), ...plantedThisBurst]);
  ageScopedStand(ctx, input, lead, holdIds);
}

function plantWithFloor(ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }, lead: CategoryRole, floor: CategoryRole): void {
  const mass = plantPatchTiers(ctx, { ...input, roles: [lead] });
  if (mass === 0) return;

  const plantedBeforeFloor = new Set(ctx.state.objects.keys());
  plantPatchTiers(ctx, {
    ...input,
    roles: [floor],
    density: input.density * FLOOR_DENSITY,
    seed: (input.seed + FLOOR_SEED_SALT) >>> 0,
  });
  const cap = Math.min(mass - 1, Math.floor(mass * FLOOR_CAP_FRACTION));
  capFloorToMass(ctx, input.cells, plantedBeforeFloor, cap);
}

/**
 * The hold's own half of the press: age one succession step (`ageStand`) whatever `holdIds` names —
 * this hold's own stand, never the whole disc (see `succession.ts`'s header on why).
 *
 * Skipped at stage 1 and where `holdIds` names nothing standing, so a short press costs exactly
 * what it cost before — which matters, because the ladder wants a habitat field and the field wants
 * an analysis of its own. The planting passes above each build one, and neither can be shared with
 * this: they run before their own plantings and the field must be read after all of them, since a
 * burst ages what the same burst has just planted. It is a whole-map scan on hold bursts only, and a
 * hold burst is already a whole macro run off the main thread.
 */
function ageScopedStand(
  ctx: MacroContext, input: PatchInput & { cells: MacroCoord[] }, lead: CategoryRole, holdIds: ReadonlySet<string>,
): void {
  const stage = input.stage ?? 1;
  const leadCategory = categoryWithRole(lead);
  if (stage <= 1 || leadCategory === undefined || ageable(ctx.state, input.cells, holdIds).length === 0) return;
  const centre = centroid(input.cells);
  const field = buildHabitatField(analyzeTerrain(ctx.state, input.cells));
  ageStand(ctx, {
    cells: input.cells,
    centre,
    ringWidth: Math.max(1, (input.radius ?? discExtent(input.cells, centre)) / CLIMAX_STAGE),
    stage,
    field,
    seed: input.seed,
    lead: leadCategory,
    holdIds,
  });
}

/** How far the disc actually reaches from its centre, for a caller that did not name a radius. */
function discExtent(cells: readonly MacroCoord[], centre: { x: number; y: number }): number {
  let far = 0;
  for (const c of cells) far = Math.max(far, Math.hypot(c.x - centre.x, c.y - centre.y));
  return far;
}
