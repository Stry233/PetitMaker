/**
 * The single-object placement and rotation curves both views sample, so `animConfig.plop` and
 * `animConfig.rotation` each mean one thing. Pure: progress in, scale or eased fraction out; each
 * view applies the result to its own sprite or instance and keeps its own reduced-motion gate.
 */
import { animConfig, easeOutBack } from './anim-config';

/** Share of the plop spent squashing to the peak before the bounce back to rest. */
const PLOP_LAND_FRAC = 0.28;
/** The smallest share of the 1×1 squash any footprint keeps, however large. */
const PLOP_MIN_AMPLITUDE = 0.4;

/**
 * Placement plop scale at progress `t` (0 to 1) for a footprint `span` cells across: a straight
 * squash to the peak over the first `PLOP_LAND_FRAC`, then `easeOutBack` back to rest with
 * `animConfig.plop.bounce` as its overshoot. Larger footprints squash less (about 1/span, floored at
 * `PLOP_MIN_AMPLITUDE`), so a big object does not read heavy. `across` scales the footprint's plane
 * and `up` the other axis (screen Y in 2D, height in 3D).
 */
export function plopScale(t: number, span: number): { across: number; up: number } {
  if (t >= 1) return { across: 1, up: 1 };
  const { squashX, squashY, bounce } = animConfig.plop;
  const f = Math.max(PLOP_MIN_AMPLITUDE, Math.min(1, 1 / Math.max(span, 1e-9)));
  const peakAcross = 1 + (squashX - 1) * f;
  const peakUp = 1 - (1 - squashY) * f;
  const u = Math.max(t, 0);
  if (u < PLOP_LAND_FRAC) {
    const k = u / PLOP_LAND_FRAC;
    return { across: 1 + (peakAcross - 1) * k, up: 1 + (peakUp - 1) * k };
  }
  const e = easeOutBack((u - PLOP_LAND_FRAC) / (1 - PLOP_LAND_FRAC), bounce);
  return { across: peakAcross + (1 - peakAcross) * e, up: peakUp + (1 - peakUp) * e };
}

/** Rotation progress at `t` (0 to 1) as the eased fraction of the turn, overshooting by
 *  `animConfig.rotation.overshoot` and landing exactly on 1. */
export function spinEase(t: number): number {
  return t >= 1 ? 1 : easeOutBack(Math.max(t, 0), animConfig.rotation.overshoot);
}
