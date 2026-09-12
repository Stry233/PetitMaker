import type { MacroCoord, MicroCoord } from '../../core/model/types';
import { ToolType } from '../../core/model/types';
import { isBuildableZone } from '../../core/model/grid-model';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { showToast } from '../../core/runtime/toast-bus';
import type { Tool, ToolContext } from '../runtime/types';
import { applyMacro, applyMacroAsync, hasMacroBuildRunner, MACRO_IDS, patchScope, type MacroId, type MacroOutcome } from './run';
import { previewMacroAsync } from './preview';
import { SmartDrag } from './drag-tool';
import { MountainSpray } from './spray-tool';
import { sprayRadius } from './spray-size';

const SPRAY_MS = 350;
const SPRAY_STEP = 3;

export function armedMacroId(ctx: ToolContext): MacroId | null {
  return ctx.armedMacro !== null && (MACRO_IDS as readonly string[]).includes(ctx.armedMacro) ? ctx.armedMacro as MacroId : null;
}


interface Spray {
  id: MacroId;
  at: MacroCoord;
  last: MacroCoord;
  watermark: number;
  changes: number;
  pending: number;
  done: boolean;
  ctx: ToolContext;
  anchor: MacroCoord;
  stage: number;
  anchorSeed: number;
  baseIds: Set<string>;
  timer: ReturnType<typeof setInterval>;
}

/** Mountain spray, endpoint drawing and planting each own their pointer lifecycle. */
export class MacroTool implements Tool {
  id = ToolType.Macro;
  cursor: CursorId = 'place';
  private seed = 1;
  private epoch = -1;
  private readonly drag = new SmartDrag();
  private readonly mountain = new MountainSpray();
  private spray: Spray | null = null;
  private applying: Promise<void> = Promise.resolve();
  private ghostToken = 0;
  private ghostKey = '';
  private previewing = false;
  private wanted: { coord: MacroCoord; key: string; ctx: ToolContext; id: MacroId; seed: number; radius: number } | null = null;

  terrainGrid(ctx: ToolContext): boolean { return ctx.armedMacro === 'raise' || ctx.armedMacro === 'stream'; }

  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    const cell = ctx.gridState.cells[coord.y]?.[coord.x];
    return !!cell && isBuildableZone(cell.zone);
  }

  private armedNow(ctx: ToolContext): MacroId | null {
    if (this.epoch !== ctx.armingEpoch) {
      this.finishSpray(); this.drag.cancel(ctx); this.mountain.cancel(ctx); this.clearGhost(ctx); this.epoch = ctx.armingEpoch;
    }
    return armedMacroId(ctx);
  }

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const id = this.armedNow(ctx);
    if (!id || !this.canActAt(coord, ctx)) return;
    this.clearGhost(ctx);
    if (id === 'raise') { this.mountain.down(coord, ctx, this.seed++); return; }
    if (!patchScope(id)) { this.drag.down(coord, ctx, id, this.seed++); return; }
    this.finishSpray();
    this.spray = {
      id, at: coord, last: coord, watermark: ctx.getUndoStackSize(), changes: 0,
      pending: 0, done: false, ctx, anchor: coord, stage: 0, anchorSeed: this.seed,
      baseIds: new Set(ctx.gridState.objects.keys()),
      timer: setInterval(() => { const s = this.spray; if (s && s.pending === 0) this.burst(s.at); }, SPRAY_MS),
    };
    this.burst(coord);
  }

  private burst(cell: MacroCoord): void {
    const spray = this.spray;
    if (!spray || !this.canActAt(cell, spray.ctx)) return;
    const { ctx } = spray;
    if (Math.hypot(cell.x - spray.anchor.x, cell.y - spray.anchor.y) >= SPRAY_STEP) {
      spray.anchor = cell; spray.stage = 0; spray.anchorSeed = this.seed;
      spray.baseIds = new Set(ctx.gridState.objects.keys());
    }
    spray.stage++; spray.pending++; spray.last = cell;
    const seed = this.seed++, heldIds = [...ctx.gridState.objects.keys()].filter(id => !spray.baseIds.has(id));
    const opts = {
      seed, at: cell, radius: sprayRadius(ctx.brushSize),
      ...(spray.stage > 1 ? { stage: spray.stage } : {}),
      ...(spray.anchorSeed !== seed ? { anchorSeed: spray.anchorSeed } : {}),
      ...(heldIds.length ? { heldIds } : {}),
    };
    const after = (outcome: MacroOutcome): void => {
      spray.changes += outcome.changes; spray.pending--;
      if (spray.done && spray.pending === 0) this.settleSpray(spray);
    };
    if (!hasMacroBuildRunner()) { after(applyMacro(ctx.macroContext, spray.id, opts)); return; }
    this.applying = this.applying.then(async () => {
      try { after(await applyMacroAsync(ctx.macroContext, spray.id, opts)); }
      catch (error) { console.error('[macro] landing failed', error); after({ changes: 0 }); }
    });
  }

  private finishSpray(): void {
    const spray = this.spray;
    if (!spray) return;
    this.spray = null; clearInterval(spray.timer); spray.done = true;
    if (spray.pending === 0) this.settleSpray(spray);
  }

  private settleSpray(spray: Spray): void {
    if (spray.ctx.getUndoStackSize() > spray.watermark + 1) spray.ctx.collapseHistory(spray.watermark);
    if (spray.changes === 0) showToast(spray.ctx.t('smart.empty'), 'warning');
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const id = this.armedNow(ctx);
    if (!id) { this.clearGhost(ctx); return; }
    if (id === 'raise') { this.mountain.move(coord, ctx, this.seed); return; }
    if (!patchScope(id)) { this.drag.move(coord, ctx); return; }
    if (this.spray) {
      this.spray.at = coord;
      if (Math.hypot(coord.x - this.spray.last.x, coord.y - this.spray.last.y) >= SPRAY_STEP && this.spray.pending === 0) this.burst(coord);
      return;
    }
    const { cellsVersion = 0, objectsVersion = 0 } = ctx.gridState;
    const radius = sprayRadius(ctx.brushSize);
    const key = [id, this.seed, radius, coord.x, coord.y, cellsVersion, objectsVersion, [...ctx.gridState.lockedLayers].join(',')].join('|');
    if (key === this.ghostKey) { this.wanted = null; return; }
    this.wanted = { coord, key, ctx, id, seed: this.seed, radius }; this.pumpGhost();
  }

  private pumpGhost(): void {
    if (this.previewing || !this.wanted) return;
    const ask = this.wanted, token = this.ghostToken;
    this.wanted = null; this.previewing = true;
    void previewMacroAsync(ask.ctx.macroContext, ask.id, { seed: ask.seed, at: ask.coord, radius: ask.radius }).then(preview => {
      if (token !== this.ghostToken || this.wanted) return;
      this.ghostKey = ask.key;
      if (!preview.added.length && !preview.removed.length && !preview.blocked.length) ask.ctx.overlay.clearGhost();
      else ask.ctx.overlay.showGhost(preview.added, { icon: null, valid: preview.valid !== false }, false, undefined, [...preview.removed, ...preview.blocked]);
    }).catch(error => { console.error('[macro] preview failed', error); }).finally(() => {
      this.previewing = false; this.pumpGhost();
    });
  }

  onPointerUp(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void { this.finishSpray(); this.drag.up(coord, ctx); this.mountain.up(coord, ctx); }
  cancelPending(ctx: ToolContext): boolean { const sprayed = this.mountain.cancel(ctx); return this.drag.cancel(ctx) || sprayed; }
  hasPending(): boolean { return this.drag.hasPending() || this.mountain.hasPending(); }
  onActivate(): void { this.seed = 1; }
  onDeactivate(ctx: ToolContext): void { this.finishSpray(); this.drag.cancel(ctx); this.mountain.cancel(ctx); this.clearGhost(ctx); }
  onPointerCancel(ctx: ToolContext): void { this.onDeactivate(ctx); }

  private clearGhost(ctx: ToolContext): void { this.wanted = null; this.ghostToken++; this.ghostKey = ''; ctx.overlay.clearGhost(); }
}
