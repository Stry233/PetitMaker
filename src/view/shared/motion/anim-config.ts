/**
 * The canvas motion registry: every animation constant both map views play (durations,
 * amplitudes, particle counts, caps). `view` ranks below `ui`, so these cannot be entries in
 * `ui/design/motion/registry.ts`, which owns DOM motion; a canvas motion is declared here and named
 * at its call site. Each one passes `platform/channels/motion-state.ts:isMotionReduced`, under
 * which it lands on its end state at once.
 *
 * The defaults favor short, springy, toy-like motion.
 */
import { hexStringToNumber } from '../../../core/base/color';
import { ERROR_RED } from '../../../assets/brand-palette';

/**
 * Overshoot ease, landing exactly on 1 at t = 1; `s` controls the overshoot. Lives here with the
 * tunables it is always paired with, so both renderers can share one curve: an easing that differs
 * between the 2D and 3D tween of the same beat is the same drift a duplicated duration would be.
 */
export function easeOutBack(t: number, s = 1.7): number {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
}

/** Ease-out cubic: fast out of the start, settling into 1. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease-out quadratic: a gentler settle than the cubic. */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** A decaying regional flash. `alpha = peakAlpha * (1 - t²)` over `durationMs`. */
interface FlashSpec {
  peakAlpha: number;
  durationMs: number;
  color: number;
}

export const animConfig = {
  flash: {
    /** "Something committed here." A light pulse — visible over any terrain
     *  (a material-tint blended into matching terrain), still well under the error curve. */
    commit: { peakAlpha: 0.35, durationMs: 200, color: 0xffffff } as FlashSpec,
    /** Rare → loud. Used by `flashErrors`. */
    error: { peakAlpha: 0.45, durationMs: 400, color: hexStringToNumber(ERROR_RED) } as FlashSpec,
    /** A repeated violation with identical evidence (a brush held over a landmark
     *  rejects once per pointer sample) stays quiet this long after its flash
     *  started, then may pulse again — one clean flash instead of a solid strobe. */
    errorRepeatCooldownMs: 900,
  },

  /** Placement plop: squash on landing, then bounce to rest. squashX/Y is
   *  the 1×1 amplitude; larger footprints get a smaller squash (scaled by ~1/size).
   *  `bounce` is the settle overshoot (higher = bouncier). */
  plop: { squashX: 1.12, squashY: 0.86, settleMs: 200, bounce: 2.6 },

  /** Deletion: collapse is the carrier; the poof fires partway through it. */
  deletion: { collapseMs: 180, poofOffsetFrac: 0.4 },

  /** Object rotation: an angular ease, not a squash — a turn reads as a
   *  rotation; a squash would read as a re-place. `overshoot` is the `easeOutBack`
   *  overshoot of the spin curve both views sample. */
  rotation: { durationMs: 180, overshoot: 2.4 },

  /** Group rotation: the selection turns as one rigid body, every member arcing about the shared
   *  centre. Longer than a single spin because a member also travels (an outer member crosses a
   *  whole radius, not just its own axis), and a milder overshoot because that travel is already
   *  the beat — the single spin's 2.4 on a swinging arm reads as a wobble. */
  groupRotation: { durationMs: 280, overshoot: 1.2 },

  /** Selection ring pop: a constant pixel travel, not a constant scale fraction. A fixed fraction
   *  moves a large footprint's edges many times as far as a single cell's, so one easing would read
   *  as a tick on a tree and a bounce on a landmark. `maxAmp` caps the travel on a sub-tile box. */
  selectionPop: { travelPx: 12, maxAmp: 0.2, durationMs: 180 },

  /** How long a camera glide the view controls start (zoom and tilt steppers, fit to map) runs in
   *  each view, eased out cubic. */
  cameraGlide: { map2dMs: 220, map3dMs: 260 },

  /** Layer-visibility fade: the whole per-elevation object container, as one
   *  fade — never per-object. */
  layerFade: { durationMs: 180 },

  /** The 3D view's opening camera fly-in (far → the resting frame). Ambient: skipped outright
   *  under reduced motion, and landed early by any camera verb, so this is how long it runs for
   *  someone who watches it rather than how long the view is held. */
  intro3d: { durationMs: 800 },

  /** Shared pooled particle emitter (spawnPuff) — placement dust + deletion poof. */
  puff: {
    globalCap: 12,        // concurrent particles across place + delete
    /** Placement dust — small, warm, settling (upward fan, mild gravity). */
    place: { count: 5, spread: 0.9, lifetimeMs: 330, risePx: 6, gravity: 8, arcSpread: 4.4, maxRadiusPx: 14, color: 0xefe6cf },
    /** Deletion poof — energetic, same-hue, near-radial scatter with gravity.
     *  count = countBase + round(area · countPerArea), capped at countCap. The
     *  spread is footprint-INDEPENDENT (a tight central burst at any size). */
    delete: { countBase: 5, countPerArea: 1 / 3, countCap: 10, spreadMul: 1.7, lifetimeMs: 340, gravity: 14, arcSpread: 6.28, risePx: 6, maxRadiusPx: 13 },
  },

  /** The 2D canvas's one-time reveal on first mount (Framer, under the editor's MotionConfig). */
  canvasReveal: { durationMs: 600, ease: [0.2, 0, 0, 1] as [number, number, number, number] },
};
