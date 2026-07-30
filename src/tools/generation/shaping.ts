// src/tools/generation/shaping.ts
import { clamp01 } from '../../core/model/math';
import type { GenConfig, ShapingParams } from './types';

// Mode sets the water/land balance (relief shapes the LAND relief).
// earth: no water, mountains. water: a sea with FLAT islands (no mountains). mixed: lakes + rivers + mountains.
const WATER_BY_MODE = { earth: 0, mixed: 0.18, water: 0.5 } as const;   // base flood fraction

/** Map the editor/agent GenConfig to the concrete shaping numbers the zone pipeline consumes:
 *  relief drives mountain coverage + ceiling, mode drives water, naturalness drives geometry style. */
export function resolveShaping(c: GenConfig): ShapingParams {
  // Floor of 0 (not 1): maxElevation=0 is a legal request for a completely FLAT map (no raised
  // land). Inputs >=1 are unaffected by the floor; only 0 flows through as a true zero ceiling.
  const maxTier = Math.max(0, Math.round(c.maxElevation));
  const earth = c.mode === 'earth';
  const landMaxTier = c.mode === 'water' ? 0 : maxTier;   // water mode: flat islands, no mountains
  return {
    // Relief drives mountain COVERAGE (threshold); Max-Height is the actual ceiling. The tallest
    // massif is normalized to reach mtnCapTier regardless of threshold.
    mtnThreshold: clamp01(0.46 - 0.34 * c.relief),         // relief 0 -> ~0.46 (gentle hills), 1 -> ~0.12 (extensive)
    mtnCapTier: landMaxTier,                               // = maxElevation (0 in water mode)
    waterCoverage: earth ? 0 : clamp01(WATER_BY_MODE[c.mode] * (0.6 + c.waterAmount)),
    maxTier,
    riverDensity: earth ? 0 : c.rivers,
    // flatness = the guaranteed buildable floor (usability peels to at least this much connected flat).
    targetFlat: clamp01(0.30 + (c.flatness - 0.5) * 0.5),  // flatness 0->0.05, .5->0.30, 1->0.55
    naturalness: clamp01(c.naturalness),                   // geometry style — consumed via geoStyle()
  };
}
