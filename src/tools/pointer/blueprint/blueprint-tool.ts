/*
 * The pointer tool for an armed blueprint: its ghost under the pointer, held by the frame's centre
 * cell as the placer holds a footprint, and a press laying it there at its turn and flip on the surface
 * under it.
 * With nothing armed it stands down as the Hand tool does.
 */
import type { Stroke } from '../../../core/commands/command-executor';
import type { MacroCoord } from '../../../core/model/types';
import { getFootprint } from '../../../core/grid/footprint';
import { gridCell, mixedCellSet, type GridCell, type GridCellRef, type MapPoint } from '../../../core/grid/grids';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { objectRect } from '../../../state/object-geometry';
import { ToolType } from '../../../state/editing/vocabulary';
import type { ToolArming } from '../../../state/editing/arming';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import type { BlueprintBody } from '../../../core/model/blueprint';
import { placeBlueprint, previewBlueprint, type BlueprintPlacement, type BlueprintPreview } from '../../blueprint/place';
import type { Tool, ToolContext } from '../runtime/types';
import type { ToolOverlay } from '../runtime/view-seam';
import type { BlueprintChannel } from './channel';
import { ghostParts } from '../runtime/placement-ghost';
import type { TrimmedCell } from '../../trim/trim-preview';
import { SQUARE_CORNERS, isSquareCorners } from '../../../core/model/corners';

type BlueprintContext = ToolContext & BlueprintChannel;

/** The placement a pointer at `cell` asks for under `arming`: the frame's top-left set so its centre
 *  cell (left of or above the middle on an even side) is `cell`; null with nothing armed. */
function placementAt(cell: MacroCoord, arming: ToolArming): BlueprintPlacement | null {
  const { body, quarters, mirror } = arming.blueprint;
  if (!body) return null;
  const [w, h] = quarters % 2 === 0 ? [body.w, body.h] : [body.h, body.w];
  return { at: { x: cell.x - Math.floor((w - 1) / 2), y: cell.y - Math.floor((h - 1) / 2) }, quarters, ...(mirror ? { mirror } : null) };
}

/** Draws what `preview` would lay: its terrain as blocks on the terrain grid, outlined in the shape
 *  each cell lands in; the cells it will skip in the loss tint; its road tiles as their surface and
 *  its other objects as bodies standing on that terrain over their footprints. The armed tool's
 *  ghost and a placed group's drag share it. */
export function showBlueprintGhost(overlay: Pick<ToolOverlay, 'showGhost' | 'showGroupPlacementGhost'>, preview: BlueprintPreview): void {
  const { cells, terrain, blocked, objects } = preview;
  const valid = lands(preview);
  const footprints: GridCellRef[] = objects.flatMap((obj) => {
    const r = objectRect(obj);
    return getFootprint(r.x, r.y, r.w, r.h).map((c) => ({ ...c, grid: PLACEMENT_GRID }));
  });
  const skipped = blocked.map((c) => gridCell(TERRAIN_GRID, c));
  const blocks = cells.map((c, i) => ({ x: c.x, y: c.y, terrain: terrain[i]! }));
  // The cells landing with a cut or as a patch, so the outline follows the shape they land in.
  const trim: TrimmedCell[] = blocks.filter((b) => b.terrain.patchOnly || (b.terrain.corners && !isSquareCorners(b.terrain.corners)))
    .map((b) => ({ x: b.x, y: b.y, corners: b.terrain.corners ?? [...SQUARE_CORNERS], patch: !!b.terrain.patchOnly, terrain: b.terrain }));
  const { tiles, members } = ghostParts(objects);
  overlay.showGhost(mixedCellSet(TERRAIN_GRID, [...cells, ...footprints]), { placement: true, valid, blocks, tiles }, trim, skipped);
  overlay.showGroupPlacementGhost(members, valid, blocks.length > 0);
}

/** Who asks for a preview: the ghost a move draws, or the verdict the cursor and a press read. */
type Asker = 'ghost' | 'verdict';

const samePlacement = (a: BlueprintPlacement, b: BlueprintPlacement): boolean =>
  a.at.x === b.at.x && a.at.y === b.at.y && a.quarters === b.quarters && !!a.mirror === !!b.mirror;

/** Whether a press would lay anything at all. */
const lands = (plan: BlueprintPreview): boolean => plan.cells.length > 0 || plan.objects.length > 0;

export class BlueprintTool implements Tool<typeof PLACEMENT_GRID, BlueprintContext> {
  readonly id = ToolType.Blueprint;
  grid(): typeof PLACEMENT_GRID { return PLACEMENT_GRID; }
  selectMode(arming: ToolArming): boolean { return arming.blueprint.body === null; }
  armedPlacement(arming: ToolArming): string | null { return arming.blueprint.armed; }
  cursor(ctx: BlueprintContext): CursorId { return ctx.arming.blueprint.body ? 'place' : 'move'; }

  /** The press in progress: its placement commits on the way down, so a cancelled press rolls it back. */
  private press: Stroke | null = null;

  /** The last preview worked out and which of the two askers made it. A pointer move asks once for the
   *  ghost and once for the cursor's verdict; the other asker takes it once, for the same placement on
   *  the same map, so an asker repeating itself after the map changed always works it out afresh. */
  private kept: {
    by: Asker; state: object; cells: number; objects: number; body: BlueprintBody; p: BlueprintPlacement; preview: BlueprintPreview;
  } | null = null;

  private plan(cell: MacroCoord, ctx: BlueprintContext, by: Asker): { p: BlueprintPlacement; preview: BlueprintPreview } | null {
    const p = placementAt(cell, ctx.arming);
    const body = ctx.arming.blueprint.body;
    if (!p || !body) return null;
    const k = this.kept;
    this.kept = null;
    // The live GridState is one mutable object, so its edit counters say whether the map changed.
    const { cellsVersion: cells, objectsVersion: objects } = ctx.state;
    if (k && k.by !== by && k.state === ctx.state && k.cells === cells && k.objects === objects && k.body === body && samePlacement(k.p, p)) {
      return { p, preview: k.preview };
    }
    const preview = previewBlueprint(ctx, body, p);
    this.kept = { by, state: ctx.state, cells, objects, body, p, preview };
    return { p, preview };
  }

  /** False only where a press would lay nothing; true with nothing armed, where a press is no refusal. */
  canActAt(cell: GridCell<typeof PLACEMENT_GRID>, ctx: BlueprintContext): boolean {
    const plan = this.plan(cell, ctx, 'verdict');
    return plan === null || lands(plan.preview);
  }

  onPointerDown(cell: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: BlueprintContext): void {
    const p = placementAt(cell, ctx.arming);
    const body = ctx.arming.blueprint.body;
    if (!p || !body) return;
    ctx.overlay.clearGhost();
    this.kept = null;
    this.press = ctx.beginStroke();
    const { seed, flip } = ctx.arming.blueprint;
    ctx.blueprintPlaced(p, placeBlueprint(ctx, body, p, seed ? { ...seed, flip } : undefined));
  }

  /** The ghost: the terrain the body lays as blocks on the terrain grid, the cells it will skip in
   *  the loss tint, and its objects as bodies standing on that terrain over their footprints. The
   *  layer panel highlights the surface the body stands on. A press holds the ghost down. */
  onPointerMove(cell: GridCell<typeof PLACEMENT_GRID>, _point: MapPoint, ctx: BlueprintContext): void {
    if (this.press) return;
    const plan = this.plan(cell, ctx, 'ghost');
    if (!plan) { ctx.overlay.clearGhost(); ctx.setDisplayLayer(null); return; }
    ctx.setDisplayLayer(plan.preview.base);
    showBlueprintGhost(ctx.overlay, plan.preview);
  }

  /** The press is over: the ghost comes back where the pointer is while a blueprint is still armed. */
  onPointerUp(cell: GridCell<typeof PLACEMENT_GRID>, point: MapPoint, ctx: BlueprintContext): void {
    this.press = null;
    this.onPointerMove(cell, point, ctx);
  }

  /** The press never happened: what it laid is taken back without a redo step. */
  onPointerCancel(): void {
    this.press?.rollback();
    this.press = null;
    this.kept = null;
  }

  onActivate(): void {}

  onDeactivate(ctx: BlueprintContext): void {
    this.press = null;
    this.kept = null;
    ctx.overlay.clearGhost();
    ctx.setDisplayLayer(null);
  }
}
