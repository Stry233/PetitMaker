import { cloneGridState, mapVersionKey } from '../../../core/model/grid-model';
import { hashJSON } from '../../../core/base/hash';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { curveArmingKey } from '../paint/curve-session';
import type { ToolArming } from '../../../state/editing/arming';
import { snapShapeEnd, splinePath } from '../../../core/grid/shapes';
import { type CurveAnchor } from '../../../core/base/spline';
import type { MacroToolContext } from './tool-context';
import type { MacroContext } from '../../macros/context';
import { previewMacroAsync } from '../../macros/runtime/preview';
import { buildMacroRun, EMPTY_KEY, hasMacroBuildRunner, landMacroRun, MACROS, prepareMacro, type MacroBuild, type MacroId, type MacroOpts } from '../../macros/run';
import { stampMap, stillStamped, type MapStamp } from '../../../core/model/fingerprint';
import { StrokePreimage } from '../paint/restore';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { mixedCellSet } from '../../../core/grid/grids';
import { LatestRequest } from './latest-request';

/** A drag carries every course option: a river's guide, a road's material and offer. */
type DragOpts = MacroOpts<'stream'> & MacroOpts<'road-link'>;

interface Gesture {
  id: MacroId;
  from: MacroCoord;
  opts: DragOpts;
  ctx: MacroToolContext;
  state: GridState;
  /** The arming at the press, which the gesture and its adjust handles stay bound to. */
  arming: ToolArming;
}
interface Adjustment extends Gesture {
  /** The map before the drag, which every adjustment builds on. */
  baseline: GridState;
  /** The same picture read off the drag's history, which every adjustment restores through. */
  preimage: StrokePreimage;
  anchors: CurveAnchor[];
  /** The map the adjustment last landed, which the next one must still find. */
  stamp: MapStamp;
}
interface PreviewRequest { gesture: Gesture; opts: DragOpts; context: MacroContext; key: string }

/** Road and river drags share a cancellable build and retain their result during adjustment. */
export class SmartDrag {
  private gesture: Gesture | null = null;
  private adjustment: Adjustment | null = null;
  private buildToken = 0;
  private pending = false;
  private readonly previews = new LatestRequest<PreviewRequest>((request, fresh) => this.showPreview(request, fresh));
  private shown = '';

  down(c: MacroCoord, ctx: MacroToolContext, id: MacroId, seed: number): void {
    if (this.adjustment) { this.cancel(ctx); return; }
    if (this.pending) return;
    this.clearGhost(ctx);
    this.gesture = {
      id, from: c, ctx, state: ctx.state, arming: ctx.arming,
      opts: {
        seed, from: c, at: c, width: ctx.arming.brushSize, trim: ctx.arming.autoEdgeCut,
        ...(ctx.arming.tileMaterialPicked ? { material: ctx.arming.tileMaterial } : {}),
        ...(ctx.arming.region?.length ? { region: [...ctx.arming.region] } : {}),
      },
    };
    this.move(c, ctx);
  }

  move(c: MacroCoord, ctx: MacroToolContext): void {
    const g = this.gesture;
    if (!g) return;
    if (!this.current(g, ctx)) { this.cancel(ctx); return; }
    const opts = this.options(g, c);
    g.opts = opts;
    if (MACROS[g.id].adjustable && opts.at!.x === g.from.x && opts.at!.y === g.from.y) return;
    this.preview(g, opts, ctx.macroContext);
  }

  up(c: MacroCoord, ctx: MacroToolContext): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (!this.current(g, ctx)) { this.cancel(ctx); return; }
    const opts = this.options(g, c);
    if (MACROS[g.id].adjustable && c.x === g.from.x && c.y === g.from.y) {
      this.clearGhost(ctx); return;
    }
    const baseline = cloneGridState(ctx.state);
    this.build(g, opts, { ...ctx.macroContext, state: baseline }, built => {
      const stroke = ctx.beginStroke();
      const result = landMacroRun(ctx.macroContext, g.id, opts, built);
      if (!result || result.changes === 0) { this.refusal(g, result?.code); return; }
      if (result.narrowedByPlanting) ctx.notify(ctx.t('smart.road_necked'), 'info');
      if (!MACROS[g.id].adjustable) return;
      const anchors = result.ends ?? opts.anchors ?? [g.from, opts.at!];
      const preimage = new StrokePreimage();
      preimage.record(stroke.entries());
      const adjustment: Adjustment = { ...g, opts, baseline, preimage, anchors, stamp: stampMap(ctx.state) };
      this.adjustment = adjustment;
      ctx.curve.begin(anchors, {
        width: opts.width ?? 1, grid: MACROS[g.id].grid, tangents: MACROS[g.id].grid === TERRAIN_GRID, armingKey: curveArmingKey(g.arming),
      }, {
        preview: next => this.previewAdjustment(adjustment, next),
        repaint: next => this.repaint(adjustment, next),
        finalize: () => { this.adjustment = null; this.buildToken++; this.pending = false; this.clearGhost(ctx); },
      });
    });
  }

  private options(g: Gesture, end: MacroCoord): DragOpts {
    const c = g.ctx.modifiers.constrain ? snapShapeEnd(g.from, end, 'line') : end;
    return {
      ...g.opts, at: c,
      ...(MACROS[g.id].adjustable && MACROS[g.id].grid === TERRAIN_GRID ? { anchors: [g.from, { x: (g.from.x + c.x) / 2, y: (g.from.y + c.y) / 2 }, c] } : {}),
    };
  }

  private current(g: Gesture, ctx = g.ctx): boolean {
    return ctx.state === g.state && ctx.arming.armingEpoch === g.arming.armingEpoch && ctx.arming.armedMacro === g.id;
  }

  private build(g: Gesture, opts: DragOpts, context: MacroContext, land: (built: MacroBuild) => void): void {
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
        if (this.adjustment === g) g.ctx.curve.resetAnchors(this.adjustment.anchors);
        if (this.current(g)) this.refusal(g);
      }
    };
    if (!hasMacroBuildRunner(context)) {
      try { finish(buildMacroRun(context, g.id, opts)); } catch (error) { failed(error); }
      return;
    }
    void prepareMacro(context, g.id, opts).then(finish).catch(failed);
  }

  private adjustmentOptions(a: Adjustment, anchors: CurveAnchor[]): DragOpts {
    const last = anchors.length - 1;
    const endpoint = (i: number, original: MacroCoord | undefined): MacroCoord | undefined =>
      anchors[i]!.x === a.anchors[i]!.x && anchors[i]!.y === a.anchors[i]!.y ? original : anchors[i];
    return { ...a.opts, from: endpoint(0, a.opts.from), at: endpoint(last, a.opts.at), ...(MACROS[a.id].grid === TERRAIN_GRID ? { anchors } : {}) };
  }

  private adjustmentCurrent(a: Adjustment): boolean {
    if (this.adjustment !== a || !this.current(a)) return false;
    if (stillStamped(a.ctx.state, a.stamp)) return true;
    this.cancel(a.ctx); return false;
  }

  private previewAdjustment(a: Adjustment, anchors: CurveAnchor[]): void {
    if (!this.adjustmentCurrent(a) || this.pending) return;
    this.preview(a, this.adjustmentOptions(a, anchors), { ...a.ctx.macroContext, state: a.baseline });
  }

  private repaint(a: Adjustment, anchors: CurveAnchor[]): void {
    if (!this.adjustmentCurrent(a)) return;
    if (this.pending) { a.ctx.curve.resetAnchors(a.anchors); return; }
    const next = anchors.map(c => ({ ...c })), opts = this.adjustmentOptions(a, next);
    this.build(a, opts, { ...a.ctx.macroContext, state: a.baseline }, built => {
      if (!this.adjustmentCurrent(a)) return;
      if (built.run.commands.length === 0) { a.ctx.curve.resetAnchors(a.anchors); this.refusal(a, built.report?.code); return; }
      const run = { base: a.stamp.fingerprint, commands: [...a.preimage.commands(a.ctx.state), ...built.run.commands] };
      const stroke = a.ctx.beginStroke();
      const result = landMacroRun(a.ctx.macroContext, a.id, opts, { ...built, run });
      if (!result || result.changes === 0) { a.ctx.curve.resetAnchors(a.anchors); this.refusal(a, result?.code); return; }
      if (result.narrowedByPlanting) a.ctx.notify(a.ctx.t('smart.road_necked'), 'info');
      a.preimage.record(stroke.entries());
      a.anchors = result.ends ?? next; a.opts = opts; a.stamp = stampMap(a.ctx.state);
      a.ctx.curve.resetAnchors(a.anchors);
    });
  }

  private refusal(g: Gesture, code?: keyof typeof EMPTY_KEY): void {
    g.ctx.notify(g.ctx.t(EMPTY_KEY[code ?? MACROS[g.id].emptyCode]), 'warning');
  }

  private preview(gesture: Gesture, opts: DragOpts, context: MacroContext): void {
    const state = context.state;
    const key = `${gesture.id}|${hashJSON(opts)}|${mapVersionKey(state)}`;
    if (key === this.shown) { this.previews.drop(); return; }
    this.previews.ask({ gesture, opts, context, key });
  }

  private showPreview(request: PreviewRequest, fresh: () => boolean): Promise<void> {
    const { gesture: g, opts, context, key } = request;
    return previewMacroAsync(context, g.id, opts).then(preview => {
      if (!fresh() || !this.current(g) || this.previews.hasWaiting()) return;
      this.shown = key;
      const cells = preview.added.length ? preview.added : splinePath(opts.anchors ?? [opts.from!, opts.at!]);
      g.ctx.overlay.showGhost(
        mixedCellSet(MACROS[g.id].grid, cells), { icon: null, valid: preview.valid !== false }, undefined, [...preview.removed, ...preview.blocked],
      );
    }).catch(error => { console.error('[macro] preview failed', error); });
  }

  hasPending(): boolean { return this.gesture !== null || this.pending || this.adjustment !== null; }

  cancel(ctx: MacroToolContext): boolean {
    const had = this.hasPending();
    this.gesture = null; this.buildToken++; this.pending = false;
    if (this.adjustment) ctx.curve.end();
    this.adjustment = null; this.clearGhost(ctx);
    return had;
  }

  private clearGhost(ctx: MacroToolContext): void {
    this.previews.reset(); this.shown = ''; ctx.overlay.clearGhost();
  }
}
