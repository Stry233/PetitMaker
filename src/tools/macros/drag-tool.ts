import { cloneGridState } from '../../core/model/grid-model';
import { hashJSON } from '../../core/model/hash';
import type { GridState, MacroCoord } from '../../core/model/types';
import { showToast } from '../../core/runtime/toast-bus';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { beginCurveSession, endCurveSession, resetCurveAnchors } from '../paint/curve-session';
import { snapShapeEnd, splinePath, type CurveAnchor } from '../paint/shapes';
import type { ToolContext } from '../runtime/types';
import type { MacroContext } from './context';
import { previewMacroAsync } from './preview';
import { buildMacroRun, EMPTY_KEY, hasMacroBuildRunner, landMacroRun, prepareMacro, type MacroBuild, type MacroId, type MacroOpts } from './run';
import { mapFingerprint } from './scratch';
import { restoreMacroCommands } from './restore';

interface Gesture {
  id: MacroId;
  from: MacroCoord;
  opts: MacroOpts;
  ctx: ToolContext;
  state: GridState;
  epoch: number;
}
interface Adjustment extends Gesture {
  baseline: GridState;
  anchors: CurveAnchor[];
  fingerprint: string;
}
interface PreviewRequest { gesture: Gesture; opts: MacroOpts; context: MacroContext; key: string }

/** Road and river drags share a cancellable build and retain their result during adjustment. */
export class SmartDrag {
  private gesture: Gesture | null = null;
  private adjustment: Adjustment | null = null;
  private buildToken = 0;
  private pending = false;
  private previewToken = 0;
  private previewing = false;
  private wanted: PreviewRequest | null = null;
  private shown = '';

  down(c: MacroCoord, ctx: ToolContext, id: MacroId, seed: number): void {
    if (this.adjustment) { this.cancel(ctx); return; }
    if (this.pending) return;
    this.clearGhost(ctx);
    this.gesture = {
      id, from: c, ctx, state: ctx.gridState, epoch: ctx.armingEpoch,
      opts: {
        seed, from: c, at: c, width: ctx.brushSize, trim: ctx.autoEdgeCut,
        ...(ctx.tileMaterialPicked ? { material: ctx.tileMaterial } : {}),
        ...(ctx.region?.length ? { region: [...ctx.region] } : {}),
      },
    };
    this.move(c, ctx);
  }

  move(c: MacroCoord, ctx: ToolContext): void {
    const g = this.gesture;
    if (!g) return;
    if (!this.current(g, ctx)) { this.cancel(ctx); return; }
    const opts = this.options(g, c);
    g.opts = opts;
    if ((g.id === 'stream' || g.id === 'road-link') && opts.at!.x === g.from.x && opts.at!.y === g.from.y) return;
    this.preview(g, opts, ctx.macroContext);
  }

  up(c: MacroCoord, ctx: ToolContext): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (!this.current(g, ctx)) { this.cancel(ctx); return; }
    const opts = this.options(g, c);
    if ((g.id === 'stream' || g.id === 'road-link') && c.x === g.from.x && c.y === g.from.y) {
      this.clearGhost(ctx); return;
    }
    const baseline = cloneGridState(ctx.gridState);
    this.build(g, opts, { ...ctx.macroContext, state: baseline }, built => {
      const result = landMacroRun(ctx.macroContext, g.id, opts, built);
      if (!result || result.changes === 0) { this.refusal(g, result?.code); return; }
      if (result.narrowedByPlanting) showToast(ctx.t('smart.road_necked'), 'info');
      if (g.id !== 'stream' && g.id !== 'road-link') return;
      const anchors = result.ends ?? opts.anchors ?? [g.from, opts.at!];
      const adjustment: Adjustment = { ...g, opts, baseline, anchors, fingerprint: mapFingerprint(ctx.gridState) };
      this.adjustment = adjustment;
      beginCurveSession(anchors, { width: opts.width ?? 1, terrainGrid: g.id === 'stream', tangents: g.id === 'stream', armingEpoch: g.epoch }, {
        preview: next => this.previewAdjustment(adjustment, next),
        repaint: next => this.repaint(adjustment, next),
        finalize: () => { this.adjustment = null; this.buildToken++; this.pending = false; this.clearGhost(ctx); },
      });
    });
  }

  private options(g: Gesture, end: MacroCoord): MacroOpts {
    const c = isConstrainHeld() ? snapShapeEnd(g.from, end, 'line') : end;
    return {
      ...g.opts, at: c,
      ...(g.id === 'stream' ? { anchors: [g.from, { x: (g.from.x + c.x) / 2, y: (g.from.y + c.y) / 2 }, c] } : {}),
    };
  }

  private current(g: Gesture, ctx = g.ctx): boolean {
    return ctx.gridState === g.state && ctx.armingEpoch === g.epoch && ctx.armedMacro === g.id;
  }

  private build(g: Gesture, opts: MacroOpts, context: MacroContext, land: (built: MacroBuild) => void): void {
    const token = ++this.buildToken;
    this.pending = true;
    const finish = (built: MacroBuild | null): void => {
      if (token !== this.buildToken) return;
      this.pending = false;
      this.clearGhost(g.ctx);
      if (!this.current(g)) return;
      if (built) land(built); else this.refusal(g);
    };
    const failed = (error: unknown): void => {
      console.error('[macro] build failed', error);
      if (token === this.buildToken) {
        this.pending = false; this.clearGhost(g.ctx);
        if (this.adjustment === g) resetCurveAnchors(this.adjustment.anchors);
        if (this.current(g)) this.refusal(g);
      }
    };
    if (!hasMacroBuildRunner()) {
      try { finish(buildMacroRun(context, g.id, opts)); } catch (error) { failed(error); }
      return;
    }
    void prepareMacro(context, g.id, opts).then(finish).catch(failed);
  }

  private adjustmentOptions(a: Adjustment, anchors: CurveAnchor[]): MacroOpts {
    const last = anchors.length - 1;
    const endpoint = (i: number, original: MacroCoord | undefined): MacroCoord | undefined =>
      anchors[i]!.x === a.anchors[i]!.x && anchors[i]!.y === a.anchors[i]!.y ? original : anchors[i];
    return { ...a.opts, from: endpoint(0, a.opts.from), at: endpoint(last, a.opts.at), ...(a.id === 'stream' ? { anchors } : {}) };
  }

  private adjustmentCurrent(a: Adjustment): boolean {
    if (this.adjustment !== a || !this.current(a)) return false;
    if (mapFingerprint(a.ctx.gridState) === a.fingerprint) return true;
    this.cancel(a.ctx); return false;
  }

  private previewAdjustment(a: Adjustment, anchors: CurveAnchor[]): void {
    if (!this.adjustmentCurrent(a) || this.pending) return;
    this.preview(a, this.adjustmentOptions(a, anchors), { ...a.ctx.macroContext, state: a.baseline });
  }

  private repaint(a: Adjustment, anchors: CurveAnchor[]): void {
    if (!this.adjustmentCurrent(a)) return;
    if (this.pending) { resetCurveAnchors(a.anchors); return; }
    const next = anchors.map(c => ({ ...c })), opts = this.adjustmentOptions(a, next);
    this.build(a, opts, { ...a.ctx.macroContext, state: a.baseline }, built => {
      if (!this.adjustmentCurrent(a)) return;
      if (built.run.commands.length === 0) { resetCurveAnchors(a.anchors); this.refusal(a, built.report?.code); return; }
      const run = { base: a.fingerprint, commands: [...restoreMacroCommands(a.ctx.gridState, a.baseline), ...built.run.commands] };
      const result = landMacroRun(a.ctx.macroContext, a.id, opts, { ...built, run });
      if (!result || result.changes === 0) { resetCurveAnchors(a.anchors); this.refusal(a, result?.code); return; }
      if (result.narrowedByPlanting) showToast(a.ctx.t('smart.road_necked'), 'info');
      a.anchors = result.ends ?? next; a.opts = opts; a.fingerprint = mapFingerprint(a.ctx.gridState);
      resetCurveAnchors(a.anchors);
    });
  }

  private refusal(g: Gesture, code?: keyof typeof EMPTY_KEY): void {
    const fallback = g.id === 'stream' ? 'river-blocked' : g.id === 'road-link' ? 'no-route' : 'terrain-blocked';
    showToast(g.ctx.t(EMPTY_KEY[code ?? fallback]), 'warning');
  }

  private preview(gesture: Gesture, opts: MacroOpts, context: MacroContext): void {
    const state = context.state;
    const key = `${gesture.id}|${hashJSON(opts)}|${state.cellsVersion ?? 0}|${state.objectsVersion ?? 0}|${[...state.lockedLayers].join(',')}`;
    if (key === this.shown) { this.wanted = null; return; }
    this.wanted = { gesture, opts, context, key };
    this.pump();
  }

  private pump(): void {
    if (this.previewing || !this.wanted) return;
    const request = this.wanted, token = this.previewToken;
    this.wanted = null; this.previewing = true;
    const { gesture: g, opts, context, key } = request;
    void previewMacroAsync(context, g.id, opts).then(preview => {
      if (token !== this.previewToken || !this.current(g) || this.wanted) return;
      this.shown = key;
      const cells = preview.added.length ? preview.added : opts.area ?? splinePath(opts.anchors ?? [opts.from!, opts.at!]);
      g.ctx.overlay.showGhost(cells, { icon: null, valid: preview.valid !== false }, g.id !== 'road-link', undefined, [...preview.removed, ...preview.blocked]);
    }).catch(error => { console.error('[macro] preview failed', error); }).finally(() => {
      this.previewing = false; this.pump();
    });
  }

  hasPending(): boolean { return this.gesture !== null || this.pending || this.adjustment !== null; }

  cancel(ctx: ToolContext): boolean {
    const had = this.hasPending();
    this.gesture = null; this.buildToken++; this.pending = false;
    if (this.adjustment) endCurveSession();
    this.adjustment = null; this.clearGhost(ctx);
    return had;
  }

  private clearGhost(ctx: ToolContext): void {
    this.previewToken++; this.wanted = null; this.shown = ''; ctx.overlay.clearGhost();
  }
}
