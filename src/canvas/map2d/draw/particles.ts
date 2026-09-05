/**
 * particles.ts — the single shared Pixi particle emitter. One pooled primitive
 * (`spawnPuff`) is reused by BOTH the placement plop (warm settling dust) and
 * the deletion poof (energetic same-hue radial scatter); callers vary it purely
 * through opts read from `anim-config`. There is one global concurrent-particle
 * cap and one motion gate — no second emitter anywhere.
 */
import * as PIXI from 'pixi.js-legacy';
import { animConfig } from '../../../core/runtime/anim-config';
import { isMotionReduced } from '../motion-state';
import { requestRender as broadcastRender } from '../render-scheduler';

/** Concurrent live-particle count across every burst (place + delete). */
let live = 0;

export interface PuffOpts {
  count: number;
  color: number;          // particle fill hue
  spreadPx: number;       // travel distance at end of life
  lifetimeMs: number;
  maxRadiusPx: number;
  risePx?: number;        // upward drift over life
  gravity?: number;       // downward acceleration over life (px, applied as g·t²)
  arcCenter?: number;     // emission center angle (rad); default -π/2 (upward)
  arcSpread?: number;     // emission arc width (rad); default ~1.6π
  behind?: boolean;       // render under the object icons (place dust) vs on top (delete poof)
}

/** Deterministic per-index jitter so a burst looks varied but is replay-stable. */
const jitter = (i: number): number => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Emit a one-shot puff of `opts.count` soft round particles at (cx, cy) in
 * `container`'s local space. Pooled into a single Graphics, self-destroying on
 * completion. Honors reduced-motion (no-op) and the global cap via the
 * "new-burst-yields" rule: if this burst would exceed the budget, it is dropped
 * whole rather than evicting particles already settling.
 */
export function spawnPuff(
  container: PIXI.Container, cx: number, cy: number, opts: PuffOpts,
  /** Opens the render window of the renderer the burst lives on — the caller's own field, or the
   *  module broadcast for one with none. */
  requestRender: () => void = broadcastRender,
): void {
  if (isMotionReduced() || opts.count <= 0) return;
  if (live + opts.count > animConfig.puff.globalCap) return; // new-burst-yields

  const n = opts.count;
  const arcCenter = opts.arcCenter ?? -Math.PI / 2;
  const arcSpread = opts.arcSpread ?? Math.PI * 1.6;
  const baseRadius = opts.maxRadiusPx * 0.6;
  const rise = opts.risePx ?? 0;
  const gravity = opts.gravity ?? 0;

  const parts = Array.from({ length: n }, (_, i) => {
    const r1 = jitter(i + 1);
    const r2 = jitter(i * 3.3 + 7);
    const r3 = jitter(i * 5.7 + 2);
    const r4 = jitter(i * 2.1 + 5);
    // Scatter the launch angle randomly across the arc (not an even fan), vary
    // spread distance + lifetime per particle, and give each a tangential `curl` so
    // its path bends over its life instead of shooting straight out — a livelier,
    // less mechanical burst. Still deterministic per index (replay-stable).
    return {
      ang: arcCenter + (r1 - 0.5) * arcSpread,
      life: opts.lifetimeMs * (0.65 + 0.7 * r2),
      distMul: 0.4 + 1.0 * r3,
      curl: (r4 - 0.5) * 2.4,
    };
  });

  live += n;
  const g = new PIXI.Graphics();
  // Below the per-elevation layer containers (zIndex>=0) for place dust → under
  // the object icons; far above them for the delete poof → over the empty spot.
  g.zIndex = opts.behind ? -1 : 9999;
  container.addChild(g);
  const start = performance.now();

  const tick = (ts: number) => {
    // The host can be torn down mid-burst (a view unmounts, a world swaps): destroying the
    // container destroys `g` with it, and a destroyed Graphics has no geometry left to clear.
    if (g.destroyed) {
      live = Math.max(0, live - n);
      return;
    }
    requestRender();        // render-on-demand: keep drawing while the puff lives
    const elapsed = ts - start;
    g.clear();
    let alive = false;
    for (const p of parts) {
      const pp = elapsed / p.life;
      if (pp < 0 || pp >= 1) continue;
      alive = true;
      // Ease-out distance: shoot out fast, then decelerate (not linear). The
      // angle curls over the particle's life so the path arcs.
      const ang = p.ang + p.curl * pp;
      const dist = opts.spreadPx * p.distMul * (1 - Math.pow(1 - pp, 3));
      const x = cx + Math.cos(ang) * dist;
      const y = cy + Math.sin(ang) * dist - rise * pp + gravity * pp * pp;
      const pulse = Math.sin(pp * Math.PI);                 // 0 → 1 → 0
      const r = Math.min(opts.maxRadiusPx, baseRadius * (0.5 + 0.8 * pulse));
      const alpha = 1 - pp * pp;
      g.beginFill(opts.color, 0.9 * alpha); g.drawCircle(x, y, r); g.endFill();
    }
    if (alive) {
      requestAnimationFrame(tick);
    } else {
      try { container.removeChild(g); g.destroy(); } catch { /* already gone */ }
      live = Math.max(0, live - n);
    }
  };
  requestAnimationFrame(tick);
}

