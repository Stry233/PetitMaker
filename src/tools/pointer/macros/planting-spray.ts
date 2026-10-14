import type { Stroke } from '../../../core/commands/command-executor';
import type { MacroCoord } from '../../../core/model/types';
import { mapVersionKey } from '../../../core/model/grid-model';
import { mixedCellSet } from '../../../core/grid/grids';
import { adjustContext } from '../paint/curve-session';
import { onBuildableGround, type MacroToolContext } from './tool-context';
import { applyMacro, applyMacroAsync, hasMacroBuildRunner, MACROS, type MacroId, type MacroOutcome } from '../../macros/run';
import { previewMacroAsync } from '../../macros/runtime/preview';
import { HOLD_BURST_MS, sprayRadius } from '../../macros/spray-size';
import { LatestRequest } from './latest-request';

const SPRAY_STEP = 3;

/** The seed counter the macro tool's presses share, so every gesture draws from one sequence. */
export interface SeedCounter {
  /** The next seed, consumed. */
  next(): number;
  /** The next seed, left for the next press. */
  peek(): number;
}

interface Spray {
  id: MacroId;
  at: MacroCoord;
  last: MacroCoord;
  /** The hold's stroke: its bursts fold into one undo entry when it settles. */
  stroke: Stroke;
  changes: number;
  pending: number;
  done: boolean;
  ctx: MacroToolContext;
  anchor: MacroCoord;
  stage: number;
  anchorSeed: number;
  baseIds: Set<string>;
  timer: ReturnType<typeof setInterval>;
}

interface GhostRequest { coord: MacroCoord; key: string; ctx: MacroToolContext; id: MacroId; seed: number; radius: number }

/** A planting hold: bursts at the pointer while it is held, staged around an anchor that moves on
 *  after `SPRAY_STEP` cells, settling as one undo entry; with nothing held, the hover ghost. */
export class PlantingSpray {
  private spray: Spray | null = null;
  private applying: Promise<void> = Promise.resolve();
  private ghostKey = '';
  private readonly ghosts = new LatestRequest<GhostRequest>((ask, fresh) => this.showGhost(ask, fresh));

  constructor(private readonly seeds: SeedCounter) {}

  down(coord: MacroCoord, ctx: MacroToolContext, id: MacroId): void {
    this.finish();
    this.spray = {
      id, at: coord, last: coord, stroke: ctx.beginStroke(), changes: 0,
      pending: 0, done: false, ctx: adjustContext(ctx), anchor: coord, stage: 0, anchorSeed: this.seeds.peek(),
      baseIds: new Set(ctx.state.objects.keys()),
      timer: setInterval(() => { const s = this.spray; if (s && s.pending === 0) this.burst(s.at); }, HOLD_BURST_MS),
    };
    this.burst(coord);
  }

  move(coord: MacroCoord, ctx: MacroToolContext, id: MacroId): void {
    if (this.spray) {
      this.spray.at = coord;
      if (Math.hypot(coord.x - this.spray.last.x, coord.y - this.spray.last.y) >= SPRAY_STEP && this.spray.pending === 0) this.burst(coord);
      return;
    }
    const radius = sprayRadius(ctx.arming.brushSize), seed = this.seeds.peek();
    const key = [id, seed, radius, coord.x, coord.y, mapVersionKey(ctx.state)].join('|');
    if (key === this.ghostKey) { this.ghosts.drop(); return; }
    this.ghosts.ask({ coord, key, ctx, id, seed, radius });
  }

  /** End the hold in progress; it settles once its bursts in flight land. */
  finish(): void {
    const spray = this.spray;
    if (!spray) return;
    this.spray = null; clearInterval(spray.timer); spray.done = true;
    if (spray.pending === 0) this.settle(spray);
  }

  clearGhost(ctx: MacroToolContext): void { this.ghosts.reset(); this.ghostKey = ''; ctx.overlay.clearGhost(); }

  private burst(cell: MacroCoord): void {
    const spray = this.spray;
    if (!spray || !onBuildableGround(cell, spray.ctx)) return;
    const { ctx } = spray;
    if (Math.hypot(cell.x - spray.anchor.x, cell.y - spray.anchor.y) >= SPRAY_STEP) {
      spray.anchor = cell; spray.stage = 0; spray.anchorSeed = this.seeds.peek();
      spray.baseIds = new Set(ctx.state.objects.keys());
    }
    spray.stage++; spray.pending++; spray.last = cell;
    const seed = this.seeds.next(), heldIds = [...ctx.state.objects.keys()].filter(id => !spray.baseIds.has(id));
    const opts = {
      seed, at: cell, radius: sprayRadius(ctx.arming.brushSize),
      ...(spray.stage > 1 ? { stage: spray.stage } : {}),
      ...(spray.anchorSeed !== seed ? { anchorSeed: spray.anchorSeed } : {}),
      ...(heldIds.length ? { heldIds } : {}),
    };
    const after = (outcome: MacroOutcome): void => {
      spray.changes += outcome.changes; spray.pending--;
      if (spray.done && spray.pending === 0) this.settle(spray);
    };
    if (!hasMacroBuildRunner(ctx.macroContext)) {
      let outcome: MacroOutcome;
      try { outcome = applyMacro(ctx.macroContext, spray.id, opts); } catch (error) { this.fail(spray, error); return; }
      after(outcome);
      return;
    }
    this.applying = this.applying.then(async () => {
      let outcome: MacroOutcome;
      try { outcome = await applyMacroAsync(ctx.macroContext, spray.id, opts); } catch (error) { this.fail(spray, error); return; }
      after(outcome);
    });
  }

  /** A landing that throws has rolled its own run back; the spray stops there and settles what
   *  earlier bursts planted as its one undo step. */
  private fail(spray: Spray, error: unknown): void {
    console.error('[macro] landing failed', error);
    if (this.spray === spray) this.spray = null;
    clearInterval(spray.timer);
    spray.done = true;
    spray.pending--;
    if (spray.pending === 0) this.settle(spray);
  }

  private settle(spray: Spray): void {
    if (spray.stroke.size > 1) spray.stroke.collapse();
    if (spray.changes === 0) spray.ctx.notify(spray.ctx.t('smart.empty'), 'warning');
  }

  private showGhost(ask: GhostRequest, fresh: () => boolean): Promise<void> {
    return previewMacroAsync(ask.ctx.macroContext, ask.id, { seed: ask.seed, at: ask.coord, radius: ask.radius }).then(preview => {
      if (!fresh() || this.ghosts.hasWaiting()) return;
      this.ghostKey = ask.key;
      if (!preview.added.length && !preview.removed.length && !preview.blocked.length) ask.ctx.overlay.clearGhost();
      else ask.ctx.overlay.showGhost(
        mixedCellSet(MACROS[ask.id].grid, preview.added), { icon: null, valid: preview.valid !== false }, undefined,
        [...preview.removed, ...preview.blocked],
      );
    }).catch(error => { console.error('[macro] preview failed', error); });
  }
}
