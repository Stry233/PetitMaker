import type { Stroke } from '../../../core/commands/command-executor';
import type { MacroCoord } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import type { Tool } from '../runtime/types';
import { onBuildableGround, type MacroToolContext } from './tool-context';
import { MACRO_IDS, MACROS, plantingOf, type MacroId } from '../../macros/run';
import { SmartDrag } from './drag-tool';
import { MountainSpray } from './spray-tool';
import { PlantingSpray } from './planting-spray';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { GridId, GridCell, MapPoint } from '../../../core/grid/grids';

function armedMacroId(ctx: Pick<MacroToolContext, 'arming'>): MacroId | null {
  return ctx.arming.armedMacro !== null && (MACRO_IDS as readonly string[]).includes(ctx.arming.armedMacro) ? ctx.arming.armedMacro as MacroId : null;
}

/** Hands each press to the gesture its macro takes (the mountain spray, an endpoint drag or a
 *  planting hold), all drawing from one seed sequence. */
export class MacroTool implements Tool<GridId, MacroToolContext> {
  id = ToolType.Macro;
  cursor(): CursorId { return 'place'; }
  private seed = 1;
  private epoch = -1;
  private readonly drag = new SmartDrag();
  private readonly mountain = new MountainSpray();
  private readonly planting = new PlantingSpray({ next: () => this.seed++, peek: () => this.seed });

  grid(ctx: Pick<MacroToolContext, 'arming'>): GridId { const id = armedMacroId(ctx); return id === null ? PLACEMENT_GRID : MACROS[id].grid; }

  canActAt(coord: MacroCoord, ctx: MacroToolContext): boolean {
    return onBuildableGround(coord, ctx);
  }

  private armedNow(ctx: MacroToolContext): MacroId | null {
    if (this.epoch !== ctx.arming.armingEpoch) {
      this.planting.finish(); this.drag.cancel(ctx); this.mountain.cancel(ctx); this.planting.clearGhost(ctx); this.epoch = ctx.arming.armingEpoch;
    }
    return armedMacroId(ctx);
  }

  /** The history depth at the press in progress: a cancelled press (a second finger landing, the
   *  browser taking the pointer) rolls back what landed since, without a redo step. */
  private press: Stroke | null = null;

  onPointerDown(coord: GridCell, _point: MapPoint, ctx: MacroToolContext): void {
    this.press = ctx.beginStroke();
    const id = this.armedNow(ctx);
    if (!id || !this.canActAt(coord, ctx)) return;
    this.planting.clearGhost(ctx);
    if (id === 'raise') { this.mountain.down(coord, ctx, this.seed++); return; }
    if (!plantingOf(id)) { this.drag.down(coord, ctx, id, this.seed++); return; }
    this.planting.down(coord, ctx, id);
  }

  onPointerMove(coord: GridCell, _point: MapPoint, ctx: MacroToolContext): void {
    const id = this.armedNow(ctx);
    if (!id) { this.planting.clearGhost(ctx); return; }
    if (id === 'raise') { this.mountain.move(coord, ctx, this.seed); return; }
    if (!plantingOf(id)) { this.drag.move(coord, ctx); return; }
    this.planting.move(coord, ctx, id);
  }

  onPointerUp(coord: GridCell, _point: MapPoint, ctx: MacroToolContext): void {
    this.press = null; this.planting.finish(); this.drag.up(coord, ctx); this.mountain.up(coord, ctx);
  }
  cancelPending(ctx: MacroToolContext): boolean { const sprayed = this.mountain.cancel(ctx); return this.drag.cancel(ctx) || sprayed; }
  hasPending(): boolean { return this.drag.hasPending() || this.mountain.hasPending(); }
  onActivate(): void { this.seed = 1; }
  onDeactivate(ctx: MacroToolContext): void { this.planting.finish(); this.drag.cancel(ctx); this.mountain.cancel(ctx); this.planting.clearGhost(ctx); }
  onPointerCancel(ctx: MacroToolContext): void {
    this.onDeactivate(ctx);
    this.press?.rollback();
    this.press = null;
  }
}
