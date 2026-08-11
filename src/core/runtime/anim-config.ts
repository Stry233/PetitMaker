/**
 * anim-config.ts — single source of truth for every CANVAS (PixiJS) animation
 * constant: durations, amplitudes, particle counts, the per-category poof
 * palette, and shared caps. Renderer layers and tools read from here so no
 * animation "magic numbers" live in render/tool code.
 *
 * (DOM / Framer-Motion timings live separately in `ui/design/styles.ts`: `springs`,
 * `easing`, `durations` — that is the React side's source of truth. Keep the
 * two in sync conceptually, but each owns its own domain.)
 *
 * The defaults favor short, springy, toy-like motion; every consumer reads
 * from here, so the feel can be tuned in one place.
 */
import { ItemCategory } from '../model/types';

/**
 * Overshoot ease, landing exactly on 1 at t = 1; `s` controls the overshoot. Lives here with the
 * tunables it is always paired with, so BOTH renderers can share one curve: an easing that differs
 * between the 2D and 3D tween of the same beat is the same drift a duplicated duration would be.
 */
export function easeOutBack(t: number, s = 1.7): number {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
}

/** A decaying regional flash. `alpha = peakAlpha * (1 - t²)` over `durationMs`. */
export interface FlashSpec {
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
    error: { peakAlpha: 0.45, durationMs: 400, color: 0xff6b6b } as FlashSpec,
    /** A repeated violation with IDENTICAL evidence (a brush held over the plaza
     *  rejects once per pointer sample) stays quiet this long after its flash
     *  started, then may pulse again — one clean flash instead of a solid strobe. */
    errorRepeatCooldownMs: 900,
    /** Latest-wins coalescing window for repeated commits (a burst restarts, never stacks). */
    coalesceWindowMs: 250,
  },

  /** Placement plop: squash on landing, then bounce to rest. squashX/Y is
   *  the 1×1 amplitude; larger footprints get a smaller squash (scaled by ~1/size).
   *  `bounce` is the settle overshoot (higher = bouncier). */
  plop: { squashX: 1.12, squashY: 0.86, settleMs: 200, bounce: 2.6 },

  /** Deletion: collapse is the carrier; the poof fires partway through it. */
  deletion: { collapseMs: 180, poofOffsetFrac: 0.4 },

  /** Object rotation: an angular ease, NOT a squash — a turn reads as a
   *  rotation; a squash would read as a re-place. */
  rotation: { durationMs: 180, overshoot: 2.4 },

  /** GROUP rotation: the selection turns as one rigid body, every member arcing about the shared
   *  centre. Longer than a single spin because a member also TRAVELS (an outer member crosses a
   *  whole radius, not just its own axis), and a milder overshoot because that travel is already
   *  the beat — the single spin's 2.4 on a swinging arm reads as a wobble. */
  groupRotation: { durationMs: 280, overshoot: 1.2 },

  /** Selection ring pop: a CONSTANT PIXEL travel, not a constant scale fraction. A fixed fraction
   *  moves a 9x9 plaza's edges nine times as far as a 1x1 tree's, so one easing would read as a
   *  tick on the tree and a bounce on the plaza. `maxAmp` caps the travel on a sub-tile box. */
  selectionPop: { travelPx: 12, maxAmp: 0.2, durationMs: 180 },

  /** Layer-visibility fade: the whole per-elevation object container, as one
   *  fade — never per-object. */
  layerFade: { durationMs: 180 },

  /** The 3D view's opening camera fly-in (far → the resting frame). AMBIENT: skipped outright
   *  under reduced motion, and landed early by any camera verb, so this is how long it runs for
   *  someone who watches it rather than how long the view is held. */
  intro3d: { durationMs: 800 },

  /** Shared pooled particle emitter (spawnPuff) — placement dust + deletion poof. */
  puff: {
    globalCap: 12,        // concurrent particles across place + delete
    rapidRepeatMs: 150,   // a 2nd emit within this window keeps only the squash/collapse
    /** Placement dust — small, warm, settling (upward fan, mild gravity). */
    place: { count: 5, spread: 0.9, lifetimeMs: 330, risePx: 6, gravity: 8, arcSpread: 4.4, maxRadiusPx: 14, color: 0xefe6cf },
    /** Deletion poof — energetic, same-hue, near-radial scatter with gravity.
     *  count = countBase + round(area · countPerArea), capped at countCap. The
     *  spread is footprint-INDEPENDENT (a tight central burst at any size). */
    delete: { countBase: 5, countPerArea: 1 / 3, countCap: 10, spreadMul: 1.7, lifetimeMs: 340, gravity: 14, arcSpread: 6.28, risePx: 6, maxRadiusPx: 13 },
  },

  /** Per-category poof tint (same-hue). Only road items carry `item.color`;
   *  icon-sprite items derive their tint from the catalog category here. */
  categoryColor: {
    [ItemCategory.Tree]: 0x7cc24a,
    [ItemCategory.Flora]: 0xf2a8c8,
    [ItemCategory.Building]: 0xe6c48a,
    [ItemCategory.Bridge]: 0xc7a06a,
    [ItemCategory.Ramp]: 0xb8aeb0,
    [ItemCategory.Road]: 0xc4a882,
    [ItemCategory.Facility]: 0xfb923c,
  } as Record<ItemCategory, number>,

  /** Fallback tint when neither `item.color` nor a category match exists (= OBJECT_COLOR). */
  fallbackColor: 0xfb923c,
};
