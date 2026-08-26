/**
 * THE STYLE TARGET AS NUMBERS, and how a measurement is scored against it.
 *
 * Every constant here is a measurement of `reference-taohua-island.json`, the decoded style target;
 * nothing is a target chosen by hand. The thresholds that belong to ONE reading live beside that
 * reading instead — these are the ones the scorecard carries across several.
 */
import type { MapMetrics } from './scorecard';

/** The style target's 1-wide share of pavement is 5.1% by the RUN definition and 6.6% by the OPENING
 *  measure the ledger reads: the two definitions differ by that much on a hand-built map, so the cap
 *  carries the gap and the target passes. */
export const ONE_WIDE_MAX = 0.08;

/** The references leave 10 and 4 tip cells out of 1964 and 2612 paved, i.e. tip cells under 0.5%. */
export const DEAD_END_MAX = 0.005;

/** With crossing footprints folded in the target still leaves several paved components (a ramp joins
 *  two levels), so plaza reachability is a share, not a partition. The target measures 95.8% here; a
 *  batch that loses a tenth of its network from the plaza fails. */
export const REACHABLE_MIN = 0.9;

/** On the references, branch (w=2) carries 38-70% of pavement and trunk (w>=3) 30-57%. */
export const WIDTH_BANDS = { w2: [0.38, 0.70], w3: [0.30, 0.57] } as const;

/** The references read 0.07 to 0.095 decor per land cell. */
export const DECOR_DENSITY_BAND = [0.07, 0.095] as const;

/** The target's north-south profile: quarter means 6.95 / 3.46 / 1.49 / 1.39, a 5.56-layer spread.
 *  A map with the target's whole gradient scores the full magnitude factor. */
export const PROFILE_RANGE_REF = 5.56;

/** The style target's own readings. */
export const REFERENCE = {
  /** By quarters, the mean elevation runs 6.95 / 3.46 / 1.49 / 1.39. */
  quarterMeans: [6.95, 3.46, 1.49, 1.39],
  /** Width distribution: w=1 5.1%, w=2 38.4%, w>=3 34.5+7.6+1.0+6.5+6.9 = 56.5%. */
  widthMix: { w1: 0.051, w2: 0.384, w3plus: 0.565 },
  /** Decor density: 0.073 per land cell. */
  decorDensity: 0.073,
  /** Paved cells: 1964, 12.0% of land. */
  pavedShare: 0.12,
  /** 69 regions, median 48 cells, mean 130. */
  regionMedian: 48,
  /** The map's own ceiling, the scale a profile distance divides by. */
  elevationScale: 8,
} as const;

/** How far a map's distributions stand from the style target's: 0 is the target's own reading, 1 is
 *  as far as the metric can sensibly go. Each term is normalized by the scale of what it measures,
 *  so the mean reads as one number. */
export interface ReferenceDistance {
  profile: number; widthMix: number; density: number; regionSize: number; pavedShare: number;
  total: number;
}

export function referenceDistance(m: MapMetrics): ReferenceDistance {
  const profile = m.elevation.quarterMeans
    .reduce((a, q, i) => a + Math.abs(q - REFERENCE.quarterMeans[i]!), 0)
    / (4 * REFERENCE.elevationScale);
  const widthMix = 0.5 * (
    Math.abs(m.roads.widthMix.w1 - REFERENCE.widthMix.w1)
    + Math.abs(m.roads.widthMix.w2 - REFERENCE.widthMix.w2)
    + Math.abs(m.roads.widthMix.w3plus - REFERENCE.widthMix.w3plus));
  const density = Math.min(1, Math.abs(m.objects.decorDensity - REFERENCE.decorDensity) / REFERENCE.decorDensity);
  const regionSize = Math.min(1, Math.abs(m.regions.median - REFERENCE.regionMedian) / REFERENCE.regionMedian);
  const pavedShare = Math.min(1, Math.abs(m.roads.pavedShare - REFERENCE.pavedShare) / REFERENCE.pavedShare);
  return {
    profile, widthMix, density, regionSize, pavedShare,
    total: (profile + widthMix + density + regionSize + pavedShare) / 5,
  };
}

/** 1 inside [lo, hi], falling linearly to 0 `slack` beyond either end. */
export function bandScore(v: number, lo: number, hi: number, slack: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / slack);
}
