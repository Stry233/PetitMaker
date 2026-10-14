import type { Stroke } from '../../../core/commands/command-executor';
import { HOLD_BURST_MS, sprayRadius } from '../../macros/spray-size';
import { cloneGridState, mapVersionKey } from '../../../core/model/grid-model';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { circleCells, line4 } from '../../../core/grid/shapes';
import type { MacroToolContext } from './tool-context';
import { adjustContext } from '../paint/curve-session';
import { LADDER_TOP, raiseFooting } from '../../macros/terrain/raise';
import { surfaceAt } from '../../macros/terrain/terrain';
import { previewMacroAsync } from '../../macros/runtime/preview';
import { buildMacroRun, EMPTY_KEY, hasMacroBuildRunner, landMacroRun, MACROS, prepareMacro, type MacroBuild, type MacroOpts } from '../../macros/run';
import { stampMap, stillStamped, type MapStamp } from '../../../core/model/fingerprint';
import { mixedCellSet } from '../../../core/grid/grids';
import { LatestRequest } from './latest-request';
import { cellKey } from '../../../core/grid/rect';

interface SprayStroke {
  ctx: MacroToolContext;
  source: MacroToolContext;
  state: GridState;
  points: MacroCoord[];
  next: number;
  released: boolean;
  base?: GridState;
  stages: Map<string, number>;
  seed: number;
  radius: number;
  peak: number;
  timer: ReturnType<typeof setInterval> | null;
  /** Begun with the baseline, at the first dab: the stroke's dabs fold into one undo entry. */
  stroke: Stroke | null;
  failed: boolean;
}

interface SprayPreview { ctx: MacroToolContext; key: string; opts: MacroOpts<'raise'> }

/** A stroke owns its baseline and seed, so repeated bursts grow the same mound and dragging
 *  blends overlapping mounds without treating their new height as a fresh foundation. */
export class MountainSpray {
  private readonly queue: SprayStroke[] = [];
  private held: SprayStroke | null = null;
  private busy = false;
  private token = 0;
  private stamp: MapStamp | null = null;
  private depth = 0;
  private ghostKey = '';
  private hoverState: GridState | null = null;
  private target = '';
  private readonly previews = new LatestRequest<SprayPreview>((request, fresh) => this.showPreview(request, fresh));

  down(c: MacroCoord, ctx: MacroToolContext, seed: number): void {
    this.clearGhost(ctx);
    if (this.queue.length && !this.current(this.queue[0]!)) this.cancel(ctx);
    if (!this.queue.length) this.remember(ctx);
    const stroke: SprayStroke = {
      source: ctx, ctx: adjustContext(ctx), state: ctx.state,
      points: [c], next: 0, released: false, stages: new Map(), seed, radius: sprayRadius(ctx.arming.brushSize),
      peak: 0, timer: null, stroke: null, failed: false,
    };
    this.held = stroke; this.queue.push(stroke);
    stroke.timer = setInterval(() => {
      if (this.busy || stroke.next < stroke.points.length) return;
      const at = stroke.points[stroke.points.length - 1]!;
      if ((stroke.stages.get(cellKey(at.x, at.y)) ?? 0) >= LADDER_TOP) return;
      stroke.points.push(at); this.pump();
    }, HOLD_BURST_MS);
    this.pump();
  }

  move(c: MacroCoord, ctx: MacroToolContext, seed: number): void {
    if (this.held) { this.append(c); this.pump(); return; }
    if (this.queue.length) return;
    const state = ctx.state, radius = sprayRadius(ctx.arming.brushSize);
    if (this.hoverState !== state) { this.clearGhost(ctx); this.hoverState = state; }
    const key = [seed, radius, c.x, c.y, mapVersionKey(state), ctx.arming.autoEdgeCut,
      ctx.arming.region?.map(p => cellKey(p.x, p.y)).join(';')].join('|');
    if (key === this.target) return;
    this.target = key;
    if (key === this.ghostKey) { this.previews.drop(); return; }
    this.previews.ask({ ctx, key, opts: { seed, at: c, radius, steepness: 'steep', trim: ctx.arming.autoEdgeCut, region: ctx.arming.region ? [...ctx.arming.region] : undefined } });
  }

  up(c: MacroCoord, _ctx: MacroToolContext): void {
    if (!this.held) return;
    this.append(c, true); this.held.released = true;
    if (this.held.timer) clearInterval(this.held.timer);
    this.held = null;
    this.pump();
  }

  private append(c: MacroCoord, final = false): void {
    const stroke = this.held;
    if (!stroke) return;
    const previous = stroke.points[stroke.points.length - 1]!;
    if (previous.x === c.x && previous.y === c.y) return;
    const { width, height } = stroke.state.template;
    const end = { x: Math.max(-1, Math.min(width, c.x)), y: Math.max(-1, Math.min(height, c.y)) };
    const spacing = Math.max(1, Math.floor(stroke.radius / 3));
    let last = previous;
    for (const point of line4(previous.x, previous.y, end.x, end.y).slice(1)) {
      if (Math.hypot(point.x - last.x, point.y - last.y) < spacing) continue;
      stroke.points.push(point); last = point;
    }
    if (final && (last.x !== end.x || last.y !== end.y)) stroke.points.push(end);
  }

  private options(s: SprayStroke, at: MacroCoord, stage: number): MacroOpts<'raise'> {
    const heldCells: number[] = [];
    for (const c of circleCells(at, s.radius, s.radius)) {
      if (surfaceAt(s.state, c.x, c.y) > surfaceAt(s.base!, c.x, c.y)) heldCells.push(c.y * s.state.template.width + c.x);
    }
    return { seed: s.seed, at, radius: s.radius, stage, steepness: 'steep',
      footing: raiseFooting(s.base!, at, s.radius), heldCells, trim: s.ctx.arming.autoEdgeCut,
      ...(s.ctx.arming.region?.length ? { region: [...s.ctx.arming.region] } : {}) };
  }

  private current(s: SprayStroke): boolean {
    return s.source.arming.armedMacro === 'raise' && s.source.arming.armingEpoch === s.ctx.arming.armingEpoch && this.unchanged(s);
  }

  private unchanged(s: SprayStroke): boolean {
    return s.source.state === s.state && s.ctx.historyDepth() === this.depth && this.stamp !== null && stillStamped(s.state, this.stamp);
  }

  private remember(ctx: MacroToolContext): void {
    this.depth = ctx.historyDepth(); this.stamp = stampMap(ctx.state);
  }

  private pump(): void {
    if (this.busy) return;
    if (this.queue.length && !this.current(this.queue[0]!)) { this.cancel(this.queue[0]!.ctx); return; }
    while (this.queue.length) {
      const s = this.queue[0]!;
      if (!s.base) { s.stroke = s.ctx.beginStroke(); s.base = cloneGridState(s.state); }
      const c = s.points[s.next++];
      if (!c) {
        s.next--;
        if (!s.released) return;
        this.finish(s); this.queue.shift(); continue;
      }
      const key = cellKey(c.x, c.y), stage = (s.stages.get(key) ?? 0) + 1;
      if (stage > LADDER_TOP) continue;
      s.stages.set(key, stage);
      const opts = this.options(s, c, stage), token = this.token;
      const land = (built: MacroBuild | null): void => {
        if (token !== this.token) return;
        if (!this.current(s)) { this.cancel(s.ctx); return; }
        // Command and layer events can synchronously resample the pointer before replay finishes.
        this.busy = true;
        try {
          const result = built ? landMacroRun(s.ctx.macroContext, 'raise', opts, built) : null;
          if (!result || (result.changes === 0 && stage === 1)) s.failed = true;
          if (result && result.changes > 0) {
            s.peak = Math.max(s.peak, (opts.footing ?? 0) + (result.peak ?? 0));
            s.ctx.setDisplayLayer(s.peak);
          }
          this.remember(s.ctx);
        } finally {
          if (token === this.token) this.busy = false;
        }
      };
      const failed = (error: unknown): void => {
        console.error('[macro] mountain spray failed', error);
        if (token !== this.token) return;
        this.busy = false; s.failed = true;
        s.next = s.points.length; s.released = true;
        if (s.timer) clearInterval(s.timer);
        if (this.held === s) this.held = null;
        this.remember(s.ctx);
      };
      if (!hasMacroBuildRunner(s.ctx.macroContext)) {
        try { land(buildMacroRun(s.ctx.macroContext, 'raise', opts)); } catch (error) { failed(error); }
        continue;
      }
      this.busy = true;
      void prepareMacro(s.ctx.macroContext, 'raise', opts).then(land).catch(failed).finally(() => {
        if (token === this.token) this.pump();
      });
      return;
    }
  }

  private finish(s: SprayStroke): void {
    this.busy = true;
    try {
      if (s.stroke && s.stroke.size > 1) s.stroke.collapse();
      this.remember(s.ctx);
    } finally { this.busy = false; }
    if (s.failed && s.stroke?.size === 0) s.ctx.notify(s.ctx.t(EMPTY_KEY['terrain-blocked']), 'warning');
  }

  private showPreview(request: SprayPreview, fresh: () => boolean): Promise<void> {
    return previewMacroAsync(request.ctx.macroContext, 'raise', request.opts).then(preview => {
      if (!fresh() || request.key !== this.target) return;
      this.previews.drop(); this.ghostKey = request.key;
      request.ctx.overlay.showGhost(mixedCellSet(MACROS.raise.grid, preview.added),
        { icon: null, valid: preview.valid !== false }, undefined, preview.blocked);
    }).catch(error => {
      if (fresh() && request.key === this.target) this.target = '';
      console.error('[macro] mountain spray preview failed', error);
    });
  }

  hasPending(): boolean { return this.queue.length > 0; }

  cancel(ctx: MacroToolContext): boolean {
    const had = this.hasPending(), active = this.queue[0];
    if (active && this.unchanged(active)) this.finish(active);
    for (const s of this.queue) if (s.timer) clearInterval(s.timer);
    this.queue.length = 0; this.held = null; this.busy = false; this.token++;
    this.clearGhost(ctx); return had;
  }

  private clearGhost(ctx: MacroToolContext): void {
    this.previews.reset(); this.target = ''; this.ghostKey = ''; ctx.overlay.clearGhost();
  }
}
