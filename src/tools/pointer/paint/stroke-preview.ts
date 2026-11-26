/**
 * The trimmed shape a build-brush ghost promises. With auto-trim on, a committed stroke has cut
 * corners and can gain Γ patches in its notches (a road stroke, cut end-caps and bends), so the ghost
 * runs the real trim pass: terrain over a scratch copy of the cells, a road over a shadowed coating
 * lookup (`previewRoadTrim`). Both return `TrimmedCell`s, so a view is handed one payload.
 */
import { CommandType } from '../../../core/model/types';
import type { Command, MacroCoord, PlacedObject } from '../../../core/model/types';
import type { RowSpan } from '../../../core/grid/cell-spans';
import { cellKey } from '../../../core/grid/rect';
import { previewAutoTrim, scratchAfter, shapeOfCells, shapeOfSpans, type GhostShape, type TrimmedCell } from '../../trim/trim-preview';
import { previewRoadTrim } from '../../trim/road-trim-preview';
import type { ToolContext } from '../runtime/types';
import type { GhostBlock, GhostGround } from '../runtime/view-seam';
import { planPaint } from './paint-plan';
import { laysTiles } from './stroke-cells';
import { paintTrimMode } from './trim-mode';

/** The probe asks as if the stroke had not started: a hover is not part of anyone's stroke. */
export const FRESH_STROKE: ReadonlySet<string> = new Set<string>();

/** `laidTiles` are the road cells this stroke laid; `before` runs on the scratch ahead of the paint
 *  (a curve's baseline restore, so an adjust ghost is not shaped by the curve it replaces). */
function trimOfShape(
  shape: GhostShape, ctx: ToolContext, before: Command[], laidTiles: ReadonlySet<string>, start: number,
): TrimmedCell[] | undefined {
  const mode = paintTrimMode(ctx);
  if (mode === 'off') return undefined;
  if (laysTiles(ctx)) {
    return previewRoadTrim(ctx.state, mode, shape, ctx.registry, {
      plan: (cells) => planPaint(cells, ctx, 'road', FRESH_STROKE).commands, laidThisStroke: laidTiles,
    });
  }
  return previewAutoTrim(ctx.state, mode, shape, ctx.registry, {
    plan: (paint, on) => planPaint(paint, { ...ctx, state: on }, ctx.arming.contentType, FRESH_STROKE, start).commands,
    before,
  })
    // The trim also reshapes the corners of terrain the stroke lands against. That is a change to the
    // map, not to the shape being placed; a Γ patch is kept, since the shape grows into that cell.
    .filter((t) => t.patch || shape.contains(t.x, t.y));
}

/** The trim a stroke started on `start` would leave over `cells`; `before` runs first, as for the lay. */
export function trimOfCells(
  cells: MacroCoord[], ctx: ToolContext, before: Command[], laidTiles: ReadonlySet<string>, start: number,
): TrimmedCell[] | undefined {
  return cells.length === 0 ? undefined : trimOfShape(shapeOfCells(cells), ctx, before, laidTiles, start);
}

/** The same for a span-form ghost (rect, circle), which never builds its own cell list: only the rim
 *  of a shape can be trimmed, and that is derivable from the spans. */
export function trimOfSpans(spans: readonly RowSpan[], ctx: ToolContext, laidTiles: ReadonlySet<string>, start: number): TrimmedCell[] | undefined {
  return spans.length === 0 ? undefined : trimOfShape(shapeOfSpans(spans), ctx, [], laidTiles, start);
}

/** What a stroke over `cells` lays, as its ghost draws it: the road tiles it paves, or the terrain
 *  blocks it raises or floods and the ground it turns. */
type StrokeLay = { tiles: PlacedObject[] } | { blocks: GhostBlock[]; ground: GhostGround[] };

/** What a ghost lays besides its cells: the trim it shows, what runs first (a curve tweak's restore)
 *  and the stroke's cell record, as the next dab plans with it. */
interface LayContext {
  trim?: readonly TrimmedCell[];
  before?: readonly Command[];
  alreadyPainted?: ReadonlySet<string>;
}

/**
 * The click's own plan (`planPaint` from the stroke's `start`) read as what it leaves: each road tile
 * it places with the cut `trim` gives it, or each terrain cell at the layer the plan's last command
 * for it lays, in the
 * shape `trim` leaves, the Γ patches the trim fills included.
 */
export function strokeLay(
  cells: readonly MacroCoord[], ctx: ToolContext, start: number,
  { trim = [], before = [], alreadyPainted = FRESH_STROKE }: LayContext = {},
): StrokeLay {
  const cut = new Map(trim.map((t) => [cellKey(t.x, t.y), t]));
  if (laysTiles(ctx)) {
    const tiles: PlacedObject[] = [];
    for (const cmd of planPaint(cells, ctx, 'road', alreadyPainted).commands) {
      if (cmd.type !== CommandType.PlaceObject) continue;
      const t = cut.get(cellKey(cmd.object.position.x, cmd.object.position.y));
      tiles.push(t?.road ? { ...cmd.object, corners: t.corners } : cmd.object);
    }
    return { tiles };
  }
  const on = scratchAfter(ctx.state, cells, before);
  const laid = new Map<string, GhostBlock>();
  const ground: GhostGround[] = [];
  for (const cmd of planPaint(cells, { ...ctx, state: on }, ctx.arming.contentType, alreadyPainted, start).commands) {
    if (cmd.type === CommandType.PlaceObject) continue;
    // A ground edit turns the cells' zone, laying no block of its own.
    if (cmd.ground !== undefined) { for (const c of cmd.cells) ground.push({ x: c.x, y: c.y, zone: cmd.ground }); continue; }
    if (cmd.type !== CommandType.PaintTerrain) continue;
    for (const c of cmd.cells) laid.set(cellKey(c.x, c.y), { x: c.x, y: c.y, terrain: { type: cmd.terrainType, elevation: cmd.elevation } });
  }
  for (const t of trim) {
    if (!t.terrain) continue;
    const key = cellKey(t.x, t.y);
    if (laid.has(key) || t.patch) laid.set(key, { x: t.x, y: t.y, terrain: t.terrain });
  }
  return { blocks: [...laid.values()], ground };
}
