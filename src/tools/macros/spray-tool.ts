import { sprayRadius } from './spray-size';
import { cloneGridState } from '../../core/model/grid-model';
import type { GridState, MacroCoord } from '../../core/model/types';
import { showToast } from '../../core/runtime/toast-bus';
import { circleCells, line4 } from '../paint/shapes';
import type { ToolContext } from '../runtime/types';
import { LADDER_TOP, raiseFooting } from './raise';
import { surfaceAt } from './terrain';
import { previewMacroAsync } from './preview';
import { buildMacroRun, EMPTY_KEY, hasMacroBuildRunner, landMacroRun, prepareMacro, type MacroBuild, type MacroOpts } from './run';
import { mapFingerprint } from './scratch';

interface SprayStroke {
  ctx: ToolContext;
  source: ToolContext;
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
  watermark: number;
  failed: boolean;
}
/** A stroke owns its baseline and seed, so repeated bursts grow the same mound and dragging
 *  blends overlapping mounds without treating their new height as a fresh foundation. */
export class MountainSpray {
  private readonly queue: SprayStroke[] = [];
  private held: SprayStroke | null = null;
  private busy = false;
  private token = 0;
  private fingerprint = '';
  private depth = 0;
  private ghostKey = '';
  private hoverState: GridState | null = null;
  private target = '';
  private previewing = false;
  private previewToken = 0;
  private wanted: { ctx: ToolContext; key: string; opts: MacroOpts } | null = null;

  down(c: MacroCoord, ctx: ToolContext, seed: number): void {
    this.clearGhost(ctx);
    if (this.queue.length && !this.current(this.queue[0]!)) this.cancel(ctx);
    if (!this.queue.length) this.remember(ctx);
    const stroke: SprayStroke = {
      source: ctx, ctx: { ...ctx, ...(ctx.region ? { region: [...ctx.region] } : {}) }, state: ctx.gridState,
      points: [c], next: 0, released: false, stages: new Map(), seed, radius: sprayRadius(ctx.brushSize),
      peak: 0, timer: null, watermark: -1, failed: false,
    };
    this.held = stroke; this.queue.push(stroke);
    stroke.timer = setInterval(() => {
      if (this.busy || stroke.next < stroke.points.length) return;
      const at = stroke.points[stroke.points.length - 1]!;
      if ((stroke.stages.get(`${at.x},${at.y}`) ?? 0) >= LADDER_TOP) return;
      stroke.points.push(at); this.pump();
    }, 350);
    this.pump();
  }

  move(c: MacroCoord, ctx: ToolContext, seed: number): void {
    if (this.held) { this.append(c); this.pump(); return; }
    if (this.queue.length) return;
    const state = ctx.gridState, radius = sprayRadius(ctx.brushSize);
    if (this.hoverState !== state) { this.clearGhost(ctx); this.hoverState = state; }
    const key = [seed, radius, c.x, c.y, state.cellsVersion, state.objectsVersion, ctx.autoEdgeCut,
      [...state.lockedLayers].sort().join(','), ctx.region?.map(p => `${p.x},${p.y}`).join(';')].join('|');
    if (key === this.target) return;
    this.target = key;
    if (key === this.ghostKey) { this.wanted = null; return; }
    this.wanted = { ctx, key, opts: { seed, at: c, radius, steepness: 'steep', trim: ctx.autoEdgeCut, region: ctx.region ? [...ctx.region] : undefined } };
    this.pumpPreview();
  }

  up(c: MacroCoord, _ctx: ToolContext): void {
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

  private options(s: SprayStroke, at: MacroCoord, stage: number): MacroOpts {
    const heldCells: number[] = [];
    for (const c of circleCells(at, s.radius, s.radius)) {
      if (surfaceAt(s.state, c.x, c.y) > surfaceAt(s.base!, c.x, c.y)) heldCells.push(c.y * s.state.template.width + c.x);
    }
    return { seed: s.seed, at, radius: s.radius, stage, steepness: 'steep',
      footing: raiseFooting(s.base!, at, s.radius), heldCells, trim: s.ctx.autoEdgeCut,
      ...(s.ctx.region?.length ? { region: [...s.ctx.region] } : {}) };
  }

  private current(s: SprayStroke): boolean {
    return s.source.armedMacro === 'raise' && s.source.armingEpoch === s.ctx.armingEpoch && this.unchanged(s);
  }

  private unchanged(s: SprayStroke): boolean {
    return s.source.gridState === s.state && s.ctx.getUndoStackSize() === this.depth && mapFingerprint(s.state) === this.fingerprint;
  }

  private remember(ctx: ToolContext): void {
    this.depth = ctx.getUndoStackSize(); this.fingerprint = mapFingerprint(ctx.gridState);
  }

  private pump(): void {
    if (this.busy) return;
    if (this.queue.length && !this.current(this.queue[0]!)) { this.cancel(this.queue[0]!.ctx); return; }
    while (this.queue.length) {
      const s = this.queue[0]!;
      if (!s.base) { s.watermark = this.depth; s.base = cloneGridState(s.state); }
      const c = s.points[s.next++];
      if (!c) {
        s.next--;
        if (!s.released) return;
        this.finish(s); this.queue.shift(); continue;
      }
      const key = `${c.x},${c.y}`, stage = (s.stages.get(key) ?? 0) + 1;
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
      if (!hasMacroBuildRunner()) {
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
      if (s.watermark >= 0 && this.depth > s.watermark + 1) s.ctx.collapseHistory(s.watermark);
      this.remember(s.ctx);
    } finally { this.busy = false; }
    if (s.failed && this.depth === s.watermark) showToast(s.ctx.t(EMPTY_KEY['terrain-blocked']), 'warning');
  }

  private pumpPreview(): void {
    if (this.previewing || !this.wanted) return;
    const request = this.wanted, token = this.previewToken;
    this.wanted = null; this.previewing = true;
    void previewMacroAsync(request.ctx.macroContext, 'raise', request.opts).then(preview => {
      if (token !== this.previewToken || request.key !== this.target) return;
      this.wanted = null; this.ghostKey = request.key;
      request.ctx.overlay.showGhost(preview.added,
        { icon: null, valid: preview.valid !== false }, true, undefined, preview.blocked);
    }).catch(error => {
      if (token === this.previewToken && request.key === this.target) this.target = '';
      console.error('[macro] mountain spray preview failed', error);
    }).finally(() => {
      this.previewing = false; this.pumpPreview();
    });
  }

  hasPending(): boolean { return this.queue.length > 0; }

  cancel(ctx: ToolContext): boolean {
    const had = this.hasPending(), active = this.queue[0];
    if (active && this.unchanged(active)) this.finish(active);
    for (const s of this.queue) if (s.timer) clearInterval(s.timer);
    this.queue.length = 0; this.held = null; this.busy = false; this.token++;
    this.clearGhost(ctx); return had;
  }

  private clearGhost(ctx: ToolContext): void {
    this.previewToken++; this.wanted = null; this.target = ''; this.ghostKey = ''; ctx.overlay.clearGhost();
  }
}
