import type { CategoryId } from '../../../core/model/types';
import type { CategoryRole } from '../../../core/model/traits';
import { makeRng } from '../../../core/base/rng';
import { smoothstep } from '../../../core/base/math';
import { valueNoise01 } from '../../../core/base/noise';
import { tryDecorate, type PlaceCtx } from '../../placement/object';
import { categoryWithRole, getPlaceableByRole } from '../../../state/catalog';
import type { PlacementAnalysis } from '../../placement/analysis';
import { stepDistance } from '../../../core/grid/cell-sets';
import { parseCellKey } from '../../../core/grid/rect';

/** The layered ecology's knobs, seeded and deterministic; densities are at nature 1, reaches in cells. */
const ECOLOGY = {
  /** Forest-stand frequency: low means large contiguous stands, not map-wide speckle. */
  standNoiseScale: 0.055,
  /** Stand noise above this is forest stand. */
  standThreshold: 0.5,
  /** Within-stand clearing frequency. */
  canopyNoiseScale: 0.17,
  /** Canopy noise below this is a glade with no trees. */
  clearingThreshold: 0.3,
  /** Cells over which tree density ramps from a stand edge (sparse) to its core (dense). */
  standEdgeSoft: 3,
  /** Tree fill at a stand core (exclusionRadius caps the realized density). */
  treeDensity: 0.95,
  /** Cells from a forest within which forest-edge flora concentrates, and its density there. */
  floraEcotoneReach: 3,
  floraEcotone: 0.4,
  /** Flora density at the waterline. */
  floraWater: 0.35,
  /** Wildflower density inside a meadow drift. */
  floraMeadow: 0.10,
  /** Drift noise frequency, and the level above which a cell is a flower drift. */
  meadowDriftScale: 0.085,
  meadowDriftThreshold: 0.63,
  /** Cells over which nature thins toward the village. */
  wildFalloffRadius: 8,
  /** Water and moisture influence radius. */
  waterFloraReach: 6,
} as const;

/**
 * What species to plant at a cell: the caller's species policy (`tools/macros/planting/habitat.ts`
 * `buildCommunity`, a habitat-sorted community). Handed the category being planted and its whole
 * placeable pool.
 *
 * Called only where a plant is about to go in, and it must draw no randomness from this module's
 * `rng` — the where is decided by that stream, and a picker that consumed from it would move every
 * later plant on the map.
 */
export type SpeciesPicker = (
  category: CategoryId, pool: readonly string[], x: number, y: number, i: number,
) => string;

/** Layered ecology: forest stands (clustered, with glades + soft edges) of the species `pick` names,
 *  wildflowers along forest edges / shorelines / meadows, thinning toward the village. Multi-tier:
 *  trees + flora populate flat plateaus too (driven by analysis.open). Deterministic from ctx.seed.
 *
 *  `roles` narrows what may be planted (the smart-build patch is bound to one brush mode at a
 *  time). Omitted means both, and an emptied pool skips its branch without drawing from `rng`, so
 *  the unrestricted run is bit-identical to one that never had the parameter.
 *
 *  `pick` decides what each plant is (see `SpeciesPicker`); this module decides only where plants go. */
export function placeNature(
  ctx: PlaceCtx, a: PlacementAnalysis, nature: number, settled: Set<string>,
  { pick, roles }: { pick: SpeciesPicker; roles?: readonly CategoryRole[] },
): void {
  if (nature <= 0) return;
  const W = a.width, H = a.height;
  const rng = makeRng(ctx.seed ^ 0x9a7e2e);
  const wanted = (r: CategoryRole): boolean => !roles || roles.includes(r);
  const canopy = categoryWithRole('canopy'), groundcover = categoryWithRole('groundcover');
  const trees = wanted('canopy') ? getPlaceableByRole('canopy') : [];
  const flora = wanted('groundcover') ? getPlaceableByRole('groundcover') : [];
  const allTreeIds = trees.map((t) => t.id);
  const allFloraIds = flora.map((f) => f.id);

  // Seeded noise fields (independent salts so they don't correlate).
  const standN = valueNoise01(ctx.seed ^ 0x70f0);
  const canopyN = valueNoise01(ctx.seed ^ 0x3b1d);
  const meadowN = valueNoise01(ctx.seed ^ 0x4d3a);
  const Ss = ECOLOGY.standNoiseScale, Sc = ECOLOGY.canopyNoiseScale;

  // Wild↔settled clearing: vegetation thins to nothing inside the village footprint.
  const settleSeeds = [...settled].map((k) => { const { x, y } = parseCellKey(k); return y * W + x; });
  const distSettle = settleSeeds.length ? stepDistance(settleSeeds, W, H) : null;
  const wildAt = (i: number): number => distSettle ? smoothstep(0, ECOLOGY.wildFalloffRadius, distSettle[i] ?? 0) : 1;

  // Waterside flora gates on true water proximity.
  const wetAt = (i: number): number => a.distToWater[i]! <= ECOLOGY.waterFloraReach ? smoothstep(ECOLOGY.waterFloraReach, 0, a.distToWater[i]!) : 0;

  // Forest stand membership per open cell (stand mask ∧ canopy, so stands have interior glades).
  const inStand = new Uint8Array(W * H);
  const openCells: number[] = [];
  for (let i = 0; i < a.open.length; i++) {
    if (a.open[i] !== 1) continue;
    openCells.push(i);
    const x = i % W, y = (i / W) | 0;
    if (standN(x * Ss, y * Ss) >= ECOLOGY.standThreshold && canopyN(x * Sc, y * Sc) >= ECOLOGY.clearingThreshold) inStand[i] = 1;
  }
  // Depth into a stand (distance from any non-forest cell → 0 at the edge, growing to the core) for soft
  // edges; and distance to a stand (for ecotone flora just outside the canopy).
  const nonStandSeeds: number[] = [], standSeeds: number[] = [];
  for (let i = 0; i < inStand.length; i++) (inStand[i] ? standSeeds : nonStandSeeds).push(i);
  const depthInStand = stepDistance(nonStandSeeds, W, H);
  const distToStand = standSeeds.length ? stepDistance(standSeeds, W, H) : null;

  // Visit open cells in a seeded-jittered order so placement isn't gridded.
  for (let k = openCells.length - 1; k > 0; k--) { const j = rng.int(k + 1); const t = openCells[k]!; openCells[k] = openCells[j]!; openCells[j] = t; }

  for (const i of openCells) {
    const x = i % W, y = (i / W) | 0;
    const wild = wildAt(i);
    if (wild <= 0) continue; // inside the village clearing

    if (inStand[i] && trees.length) {
      // Dense in the stand core, soft at the edge.
      const core = smoothstep(0, ECOLOGY.standEdgeSoft, depthInStand[i] ?? 0);
      if (rng.float() < nature * ECOLOGY.treeDensity * (0.35 + 0.65 * core) * wild) {
        tryDecorate(ctx, pick(canopy!, allTreeIds, x, y, i), x, y); // exclusionRadius spaces them; clearance keeps gates/crossings clear; reject → skip
        continue;
      }
    }

    if (flora.length) {
      // Flora concentrates at the forest edge (ecotone), the waterline, and inside meadow drifts —
      // patchy wildflower fields with clear grass between them, never a uniform confetti over the map.
      const ecotone = distToStand && !inStand[i] ? ECOLOGY.floraEcotone * smoothstep(ECOLOGY.floraEcotoneReach, 0, distToStand[i]!) : 0;
      const waterside = ECOLOGY.floraWater * wetAt(i);
      const drift = meadowN(x * ECOLOGY.meadowDriftScale, y * ECOLOGY.meadowDriftScale) >= ECOLOGY.meadowDriftThreshold ? ECOLOGY.floraMeadow : 0;
      const p = nature * Math.max(drift, ecotone, waterside) * wild;
      if (rng.float() < p) {
        tryDecorate(ctx, pick(groundcover!, allFloraIds, x, y, i), x, y); // 1×1 flora stays allowed in clearance zones
      }
    }
  }
}
