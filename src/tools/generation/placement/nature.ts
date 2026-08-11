import { ItemCategory } from '../../../core/model/types';
import { makeRng } from '../../../core/model/rng';
import { clamp01, smoothstep } from '../../../core/model/math';
import { valueNoise01 } from '../../../core/model/noise';
import { TUNING } from '../tuning';
import { tryDecorate, type PlaceCtx } from './object';
import { getPlaceableByCategory } from '../../../state/catalog';
import { distanceField, type PlacementAnalysis } from './analysis';

// Tree species grouped into climate bands; the populator picks a band from (elevation, moisture) so a
// stand reads as one ecosystem. Ids missing from the catalog are filtered out (graceful if it changes).
const TREE_BANDS: Record<string, string[]> = {
  highland: ['tree-fir', 'tree-ginkgo'],
  dry: ['tree-cactus', 'tree-baobab', 'tree-dragonblood', 'tree-flame'],
  wet: ['tree-mango', 'tree-avocado', 'tree-bamboo'],
  temperate: ['tree-apple', 'tree-peach', 'tree-plum'],
};

/**
 * What species to plant at a cell, for a caller with a species policy of its own (the smart-build
 * press's habitat-sorted community). Handed the WHOLE placeable pool of the category, not the
 * climate band this module would otherwise narrow to: a caller that supplies a picker is replacing
 * the species policy, not filtering it.
 *
 * Called only where a plant is about to go in, and it must draw no randomness from this module's
 * `rng` — the WHERE is decided by that stream, and a picker that consumed from it would move every
 * later plant on the map.
 */
export type SpeciesPicker = (
  category: ItemCategory, pool: readonly string[], x: number, y: number, i: number,
) => string;

/** Layered ecology: forest STANDS (clustered, with glades + soft edges) of biome-appropriate species,
 *  wildflowers along forest edges / shorelines / meadows, thinning toward the village. Multi-tier:
 *  trees + flora populate flat plateaus too (driven by analysis.open). Deterministic from ctx.seed.
 *
 *  `categories` narrows what may be planted (the smart-build patch is bound to one brush mode at a
 *  time). Omitted means both, and an emptied pool skips its branch without drawing from `rng`, so
 *  the unrestricted run is bit-identical to one that never had the parameter.
 *
 *  `pick` replaces the species choice only (see `SpeciesPicker`); where a plant goes is unchanged. */
export function placeNature(ctx: PlaceCtx, a: PlacementAnalysis, nature: number, settled: Set<string>, categories?: readonly ItemCategory[], pick?: SpeciesPicker): void {
  if (nature <= 0) return;
  const W = a.width, H = a.height;
  const rng = makeRng(ctx.seed ^ 0x9a7e2e);
  const wanted = (c: ItemCategory): boolean => !categories || categories.includes(c);
  const trees = wanted(ItemCategory.Tree) ? getPlaceableByCategory(ItemCategory.Tree) : [];
  const flora = wanted(ItemCategory.Flora) ? getPlaceableByCategory(ItemCategory.Flora) : [];
  const allTreeIds = trees.map((t) => t.id);
  const allFloraIds = flora.map((f) => f.id);
  // Resolve each band to the trees that actually exist; empty bands fall back to the whole list.
  const bandTrees: Record<string, string[]> = {};
  for (const k of Object.keys(TREE_BANDS)) {
    const present = TREE_BANDS[k]!.filter((id) => allTreeIds.includes(id));
    bandTrees[k] = present.length ? present : allTreeIds;
  }

  // Seeded noise fields (independent salts so they don't correlate).
  const standN = valueNoise01(ctx.seed ^ 0x70f0);
  const canopyN = valueNoise01(ctx.seed ^ 0x3b1d);
  const meadowN = valueNoise01(ctx.seed ^ 0x4d3a);
  const humidityN = valueNoise01(ctx.seed ^ 0x51a7);
  const treeSpeciesN = valueNoise01(ctx.seed ^ 0x2c9f);
  const floraSpeciesN = valueNoise01(ctx.seed ^ 0x8e3a);
  const Ss = TUNING.standNoiseScale, Sc = TUNING.canopyNoiseScale, Sm = TUNING.moistureNoiseScale;

  // Wild↔settled clearing: vegetation thins to nothing inside the village footprint.
  const settleSeeds = [...settled].map((k) => { const [x, y] = k.split(',').map(Number); return y! * W + x!; });
  const distSettle = settleSeeds.length ? distanceField(settleSeeds, W, H) : null;
  const wildAt = (i: number): number => distSettle ? smoothstep(0, TUNING.wildFalloffRadius, distSettle[i] ?? 0) : 1;

  // Moisture: blend a humidity field with proximity to water. Drives tree-species banding only —
  // waterside FLORA gates on `wetAt` (true water proximity), or the ambient humidity term turns the
  // shoreline flowers into a map-wide confetti.
  const wetAt = (i: number): number => a.distToWater[i]! <= TUNING.waterFloraReach ? smoothstep(TUNING.waterFloraReach, 0, a.distToWater[i]!) : 0;
  const moistureAt = (i: number, x: number, y: number): number => clamp01(0.5 * humidityN(x * Sm, y * Sm) + 0.5 * wetAt(i));

  // Forest stand membership per open cell (stand mask ∧ canopy, so stands have interior glades).
  const inStand = new Uint8Array(W * H);
  const openCells: number[] = [];
  for (let i = 0; i < a.open.length; i++) {
    if (a.open[i] !== 1) continue;
    openCells.push(i);
    const x = i % W, y = (i / W) | 0;
    if (standN(x * Ss, y * Ss) >= TUNING.standThreshold && canopyN(x * Sc, y * Sc) >= TUNING.clearingThreshold) inStand[i] = 1;
  }
  // Depth into a stand (distance from any non-forest cell → 0 at the edge, growing to the core) for soft
  // edges; and distance TO a stand (for ecotone flora just outside the canopy).
  const nonStandSeeds: number[] = [], standSeeds: number[] = [];
  for (let i = 0; i < inStand.length; i++) (inStand[i] ? standSeeds : nonStandSeeds).push(i);
  const depthInStand = distanceField(nonStandSeeds, W, H);
  const distToStand = standSeeds.length ? distanceField(standSeeds, W, H) : null;

  const pickTreeBand = (elev: number, moisture: number): string[] => {
    if (elev >= TUNING.highlandTier) return bandTrees.highland!;
    if (moisture < 0.34) return bandTrees.dry!;
    if (moisture > 0.62) return bandTrees.wet!;
    return bandTrees.temperate!;
  };

  // Visit open cells in a seeded-jittered order so placement isn't gridded.
  for (let k = openCells.length - 1; k > 0; k--) { const j = rng.int(k + 1); const t = openCells[k]!; openCells[k] = openCells[j]!; openCells[j] = t; }

  for (const i of openCells) {
    const x = i % W, y = (i / W) | 0;
    const wild = wildAt(i);
    if (wild <= 0) continue; // inside the village clearing
    const moisture = moistureAt(i, x, y);

    if (inStand[i] && trees.length) {
      // Dense in the stand core, soft at the edge.
      const core = smoothstep(0, TUNING.standEdgeSoft, depthInStand[i] ?? 0);
      if (rng.float() < nature * TUNING.treeDensity * (0.35 + 0.65 * core) * wild) {
        const band = pickTreeBand(a.elev[i] ?? 0, moisture);
        const species = pick
          ? pick(ItemCategory.Tree, allTreeIds, x, y, i)
          : band[Math.floor(treeSpeciesN(x * TUNING.treeSpeciesScale, y * TUNING.treeSpeciesScale) * band.length) % band.length]!;
        tryDecorate(ctx, species, x, y); // exclusionRadius spaces them; clearance keeps gates/crossings clear; reject → skip
        continue;
      }
    }

    if (flora.length) {
      // Flora concentrates at the forest edge (ecotone), the waterline, and inside meadow DRIFTS —
      // patchy wildflower fields with CLEAR grass between them, never a uniform confetti over the map.
      const ecotone = distToStand && !inStand[i] ? TUNING.floraEcotone * smoothstep(TUNING.floraEcotoneReach, 0, distToStand[i]!) : 0;
      const waterside = TUNING.floraWater * wetAt(i);
      const drift = meadowN(x * TUNING.meadowDriftScale, y * TUNING.meadowDriftScale) >= TUNING.meadowDriftThreshold ? TUNING.floraMeadow : 0;
      const p = nature * Math.max(drift, ecotone, waterside) * wild;
      if (rng.float() < p) {
        const sp = pick
          ? pick(ItemCategory.Flora, allFloraIds, x, y, i)
          : flora[Math.floor(floraSpeciesN(x * TUNING.floraSpeciesScale, y * TUNING.floraSpeciesScale) * flora.length) % flora.length]!.id;
        tryDecorate(ctx, sp, x, y); // 1×1 flora stays allowed in clearance zones
      }
    }
  }
}
