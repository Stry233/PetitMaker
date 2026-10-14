import type { Stroke } from '../../../core/commands/command-executor';
import { paintTrimMode } from './trim-mode';
import { entryCells } from '../../../core/commands/command-apply';
import { cellsOn } from '../../../core/grid/grid-convert';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import type { ValidationError } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import type { ToolContext } from '../runtime/types';
import { applyAutoEdgeCut } from '../../trim/auto-edge-cut';
import { visibleTrims } from './stroke-finish';

/** Validate erasure before trimming its surviving footprint, then keep both in one undo step. */
export function finishEraserStroke(ctx: ToolContext, stroke: Stroke, erased: Stroke = stroke): ValidationError[] {
  const changed = erased.entries().flatMap(entryCells);
  const tile = ctx.arming.contentType === 'road';
  const errors = stroke.commit();
  const trim = paintTrimMode(ctx);
  if (errors.length || trim === 'off' || stroke.size <= 0) return errors;
  const trimStroke = ctx.beginStroke();
  const sweep = visibleTrims({ state: ctx.state, roads: roadLookup(ctx.state), execute: ctx.execute }, ctx.arming.layerVisibility);
  applyAutoEdgeCut(sweep, trim, tile ? [] : cellsOn(changed, TERRAIN_GRID), tile ? cellsOn(changed, PLACEMENT_GRID) : []);
  if (trimStroke.size === 0) return [];
  const trimErrors = trimStroke.commit();
  const finalErrors = trimErrors.length ? trimErrors : ctx.registry.validatePostStroke(ctx.state);
  if (finalErrors.length) trimStroke.rollback();
  stroke.collapse();
  return finalErrors;
}
