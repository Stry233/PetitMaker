import { getAffectedCells } from '../../core/commands/command-apply';
import { CommandType, type ValidationError } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { roadLookup } from '../../state/object-index';
import type { ToolContext } from '../runtime/types';
import { applyAutoEdgeCut } from '../edge-cut/auto-edge-cut';

/** Validate erasure before trimming its surviving footprint, then keep both in one undo step. */
export function finishEraserStroke(ctx: ToolContext, start: number, erasedSince = start): ValidationError[] {
  const changed = ctx.macroContext.executor.commandsSince(erasedSince).flatMap(getAffectedCells);
  const errors = ctx.commitStroke(start);
  if (errors.length || ctx.autoEdgeCut === 'off' || ctx.getUndoStackSize() <= start) return errors;
  const trimStart = ctx.getUndoStackSize();
  const roads = roadLookup(ctx.gridState);
  applyAutoEdgeCut({
    gridState: ctx.gridState,
    roads,
    executeCommand(command) {
      if (command.type === CommandType.TrimCorners) {
        const standing = command.layer === 'road'
          ? roads(command.x, command.y)?.elevation ?? 0
          : getCell(ctx.gridState.cells, command.x, command.y)?.terrain?.elevation ?? 0;
        const target = command.elevation ?? standing;
        if (ctx.layerVisibility[standing] === false || ctx.layerVisibility[target] === false
          || [...ctx.gridState.lockedLayers].some(layer => layer === target || layer > 0 && layer <= Math.max(standing, target))) {
          return { success: false, errors: [] };
        }
      }
      return ctx.executeCommand(command);
    },
  }, ctx.autoEdgeCut, ctx.contentType === 'tile' ? [] : changed, ctx.contentType === 'tile' ? changed : []);
  if (ctx.getUndoStackSize() === trimStart) return [];
  const trimErrors = ctx.commitStroke(trimStart);
  const finalErrors = trimErrors.length ? trimErrors : ctx.rules.validatePostStroke(ctx.gridState);
  if (finalErrors.length) ctx.rollbackTo(trimStart);
  ctx.collapseHistory(start);
  return finalErrors;
}
