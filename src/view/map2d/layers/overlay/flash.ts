import * as PIXI from 'pixi.js-legacy';
import { QUADRANT_PX, TILE_SIZE, gridOffsetPx } from '../../geometry/world';
import { animConfig } from '../../../shared/motion/anim-config';
import { drawTrimmedBlock } from '../../draw/trim-shapes';
import type { Corners, ValidationError } from '../../../../core/model/types';
import { type CellSet, type GridCellRef } from '../../../../core/grid/grids';
import { FlashPolicy, flashDecay, type ErrorFlashRect, type FlashKind } from '../../../shared/overlay/error-flash';
import { splitFlashShapes } from '../../../shared/overlay/ghost-geometry';
import { mergeCellSpans } from '../../../../core/grid/cell-spans';
import type { OverlayHost } from './host';
import { timedBeat } from '../../../shared/viewport/frame-loop';
import { bodyRect, spanRect } from './paint';

/** The refusal and commit flashes: cells and bodies fading out from a peak. */
export class OverlayFlashes {
  constructor(private readonly host: OverlayHost) {}

  readonly errorGraphics = new PIXI.Graphics();
  readonly commitGraphics = new PIXI.Graphics();
  private stopCommit: (() => void) | null = null;
  /** What shape a cell actually holds, for the flashes. Auto-trim cuts corners, so a flash of flat
   *  squares advertises a result the map does not have. Supplied by the renderer, which owns the
   *  live grid; absent (or for a macro-grid object flash) every cell reads as a plain square. */
  private shapeAt: (x: number, y: number) => { corners?: Corners; patchOnly?: boolean } | null = () => null;

  /** Point the flashes at the live grid. */
  setShapeSource(fn: (x: number, y: number) => { corners?: Corners; patchOnly?: boolean } | null): void {
    this.shapeAt = fn;
  }

  private stopError: (() => void) | null = null;

  /**
   * Shared alpha-fade flash loop (`alpha = peakAlpha·(1 − t²)`, ease-out: fast
   * attack, slow fade). Draws the cells as merged row spans each tick until the
   * alpha decays below the visible floor; `requestRender()` keeps it at 60fps
   * while live. Callers own the graphics lifecycle + animId storage via the callbacks.
   */
  private flashCells(opts: {
    g: PIXI.Graphics;
    cells: readonly GridCellRef[];
    /** Bodies to flash whole (an object's drawn footprint) — see `ErrorFlashRect`. Few by
     *  construction (one per accused body), so they need no span merging. */
    rects?: readonly ErrorFlashRect[];
    color: number;
    peakAlpha: number;
    durationMs: number;
    setStop: (stop: (() => void) | null) => void;
    onEnd: () => void;
  }): void {
    if (this.host.disposed) { opts.onEnd(); return; }
    const { g, cells, rects = [], color, peakAlpha, durationMs } = opts;
    // Resolved once, against the map as it now stands — see `splitFlashShapes`.
    const { shaped, plain } = splitFlashShapes(cells, this.shapeAt);
    // Row spans, merged once: the fade refills its Graphics every frame, and a
    // large region (a whole-shape commit, a big footprint) as per-cell rects
    // would tessellate tens of thousands of rects per frame.
    const spans = mergeCellSpans(plain);
    let ended = false;
    const stop = this.host.play(timedBeat(durationMs, (t) => {
      const alpha = flashDecay(peakAlpha, t);
      g.clear();
      if (alpha > 0.01) {
        g.beginFill(color, alpha);
        for (const sp of spans) spanRect(g, sp);
        for (const r of rects) bodyRect(g, r);
        g.endFill();
        for (const c of shaped) {
          const shift = gridOffsetPx(c.grid);
          const block = { bx: c.x * TILE_SIZE + shift.x, by: c.y * TILE_SIZE + shift.y, halfSize: QUADRANT_PX };
          drawTrimmedBlock(g, c.corners as Corners, block, { color, alpha, patchOnly: c.patchOnly });
        }
        return true;
      }
      ended = true;
      opts.onEnd();
      return false;
    }));
    if (!ended) opts.setStop(stop);
  }

  private readonly policy = new FlashPolicy(() => performance.now());

  /** Stop the `kind` flash still fading, the policy's latest-wins. */
  private replace(kind: FlashKind): void {
    (kind === 'error' ? this.stopError : this.stopCommit)?.();
    if (kind === 'error') { this.stopError = null; this.errorGraphics.clear(); } else this.stopCommit = null;
  }

  /**
   * Flash red on the errors' evidence (ValidationError.cells — the cells that cause the
   * violation — or, where the cause is an object, `ValidationError.rects`, its drawn body):
   * a quick bright flash that fades out smoothly, each error on its own grid (`FlashPolicy`).
   */
  flashErrors(errors: ValidationError[]): void {
    const plan = this.policy.errors(errors);
    if (!plan) return;
    this.replace('error');
    this.flashCells({
      g: this.errorGraphics,
      cells: plan.cells,
      rects: plan.rects,
      color: animConfig.flash.error.color,
      peakAlpha: animConfig.flash.error.peakAlpha,
      durationMs: animConfig.flash.error.durationMs,
      setStop: (stop) => { this.stopError = stop; },
      onEnd: () => { this.stopError = null; },
    });
  }

  /** Commit-acknowledge flash: one low-amplitude regional pulse over `sets`, each on its own grid
   *  (`animConfig.flash.commit`, `FlashPolicy`). */
  flashCommit(sets: readonly CellSet[], opts: { color?: number } = {}): void {
    const plan = this.policy.commit(sets);
    if (!plan) return;
    const { peakAlpha, durationMs, color: defaultColor } = animConfig.flash.commit;
    this.replace('commit');
    this.flashCells({
      g: this.commitGraphics,
      cells: plan.cells,
      color: opts.color ?? defaultColor,
      peakAlpha,
      durationMs,
      setStop: (stop) => { this.stopCommit = stop; },
      onEnd: () => { this.endCommitFlash(); },
    });
  }

  private endCommitFlash(): void {
    if (!this.host.disposed) this.commitGraphics.clear();
    this.stopCommit = null;
  }

  dispose(): void {
    this.stopError?.();
    this.stopCommit?.();
    this.stopError = this.stopCommit = null;
  }
}
