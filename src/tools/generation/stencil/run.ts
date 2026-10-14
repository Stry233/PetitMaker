/**
 * A stencil run as the facade reports it: the plan laid (`stencil-generator.ts:runStencilPlan`),
 * then the staircase outline trimmed back toward the source's own edge.
 */
import { TerrainType } from '../../../core/model/types';
import type { MacroCoord } from '../../../core/model/types';
import type { MapWriter } from '../terrain-plan/types';
import type { StencilBudgetOutcome, StencilPlan } from '../recipe';
import { getCell } from '../../../core/model/grid-model';
import { edgeCutGeneratedTerrain, edgeCutTerrainWith } from '../../trim/auto-edge-cut';
import { runStencilPlan } from './stencil-generator';
import { stencilChooser } from './stencil-trim';

export interface StencilRun {
  placed: number;
  skipped: number;
  /** How an object stencil met its regional load budget; absent when it fit. */
  stencilBudget?: StencilBudgetOutcome;
  /** Where a text run landed: the surface tier the glyph stands one layer above, and the three ways
   *  a covered cell can be left alone (crossing a step or a pond, reaching the edge of the ground the
   *  word stands on, or standing on the tallest layer the grid has). */
  stencil?: { base: number; offBase: number; unsupported: number; atCeiling: number };
}

export function generateStencil(
  { state, execute: executeCommand }: MapWriter,
  plan: StencilPlan,
  maxElevation: number,
): StencilRun {
  const { placed, skipped, base, offBase, unsupported, atCeiling, budget } = runStencilPlan(state, plan, maxElevation, executeCommand);
  if (budget === 'blocked') return { placed: 0, skipped: 0, stencilBudget: budget };
  // Trim is part of the approximation. A stencil is quantised to whole cells, so its outline is
  // a staircase; the cut pass recovers the diagonal the letter's stroke or the picture's edge
  // had. Each corner's shape comes from the source's sub-cell coverage (`stencil-trim.ts`); a
  // stencil with no quadrant detail takes the whole-pass round mode.
  const { origin, stencil } = plan;
  const touched: MacroCoord[] = [];
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      const c = { x: origin.x + x, y: origin.y + y };
      const t = getCell(state.cells, c.x, c.y)?.terrain;
      if (t && (t.type === TerrainType.Mountain || t.type === TerrainType.Water)) touched.push(c);
    }
  }
  if (touched.length && !(plan.read === 'shape' && (stencil.cellAligned || plan.fill?.kind === 'stroke'))) {
    const pick = stencilChooser(origin, stencil);
    if (pick) edgeCutTerrainWith({ state, execute: executeCommand }, touched, pick);
    else edgeCutGeneratedTerrain({ state, execute: executeCommand }, touched, 'round');
  }
  return {
    placed, skipped,
    ...(budget ? { stencilBudget: budget } : {}),
    ...(base !== undefined
      ? { stencil: { base, offBase: offBase ?? 0, unsupported: unsupported ?? 0, atCeiling: atCeiling ?? 0 } }
      : {}),
  };
}
