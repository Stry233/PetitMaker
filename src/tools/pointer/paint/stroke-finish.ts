/**
 * The end of a paint stroke, shared by the drawing tool and the Help Center's pictured strokes: the
 * post-stroke rules run back to the stroke's mark (reverting what they refuse), a refused water stroke
 * learns the one layer it could stand at, and the auto edge-trim sweeps the cells that survived,
 * folded into the stroke's own undo entry.
 */
import { CommandType, type MacroCoord, type ValidationError } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { roadLookup } from '../../../state/object-index';
import type { Stroke } from '../../../core/commands/command-executor';
import type { AutoEdgeCut } from '../../../state/editing/vocabulary';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import { applyAutoEdgeCut, type EdgeCutCtx } from '../../trim/auto-edge-cut';
import { soleLegalWaterLayer } from './water-layers';

export interface StrokeFinishCtx extends EdgeCutCtx {
  registry: RuleDispatcher;
}

export interface StrokeFinish {
  stroke: Stroke;
  /** The terrain cells the stroke painted, and the road tiles it laid. */
  terrainCells: MacroCoord[];
  tileCells?: MacroCoord[];
  /** Whether the stroke laid water, whose refusal can name the layer that would take it. */
  water: boolean;
  trim: AutoEdgeCut;
  /** Runs before the trim sweep, after the rules: a tool squares the cuts it drew while dragging. */
  beforeTrim?: () => void;
  /** The layers the user has hidden (`false`); the sweep leaves what stands on them as it is. */
  layerVisibility?: Readonly<Record<number, boolean>>;
}

export interface StrokeOutcome {
  violations: ValidationError[];
  /** Whether anything of the stroke survived the rules, read before the trim sweep. */
  committed: boolean;
  /** For a refused water stroke, the one layer it could legally stand at. */
  waterLayer: number | null;
  /** The cells the trim sweep changed, which can lie outside the stroke. */
  trimmed: MacroCoord[];
}

/** `ctx` with the trims that would reshape terrain or a road on a hidden layer skipped, for the
 *  brush's and the eraser's sweeps alike. Locked layers are V-LOCK-01's to refuse. */
export function visibleTrims(ctx: EdgeCutCtx, layerVisibility: Readonly<Record<number, boolean>> = {}): EdgeCutCtx {
  if (!Object.values(layerVisibility).includes(false)) return ctx;
  return {
    get state() { return ctx.state; },
    get roads() { return ctx.roads; },
    execute(command) {
      if (command.type === CommandType.TrimCorners) {
        const standing = command.layer === 'road'
          ? (ctx.roads ?? roadLookup(ctx.state))(command.x, command.y)?.elevation ?? 0
          : getCell(ctx.state.cells, command.x, command.y)?.terrain?.elevation ?? 0;
        if (layerVisibility[standing] === false || layerVisibility[command.patchOnly ? command.elevation : standing] === false) {
          return { success: false, errors: [] };
        }
      }
      return ctx.execute(command);
    },
  };
}

export function finishPaintStroke(
  ctx: StrokeFinishCtx, { stroke, terrainCells, tileCells = [], water, trim, beforeTrim, layerVisibility }: StrokeFinish,
): StrokeOutcome {
  const violations = stroke.commit();
  const committed = stroke.size > 0;
  // Asked of the map after the revert, the ground the next attempt is laid on.
  const waterLayer = violations.length > 0 && water ? soleLegalWaterLayer(terrainCells, ctx.state, ctx.registry) : null;
  let trimmed: MacroCoord[] = [];
  if (trim !== 'off' && (terrainCells.length > 0 || tileCells.length > 0)) {
    const untrimmed = stroke.size;
    beforeTrim?.();
    trimmed = applyAutoEdgeCut(visibleTrims(ctx, layerVisibility), trim, terrainCells, tileCells);
    // The commit left at most one entry, so the trim folds into the stroke's own.
    if (stroke.size > untrimmed) stroke.collapse();
  }
  return { violations, committed, waterLayer, trimmed };
}
