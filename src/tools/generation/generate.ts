/**
 * The generation facade: a recipe in, a built map out, and the clearing a run stands on.
 *
 * It dispatches `config.algorithm` to one of the three generators beside it, each behind its own
 * door: `designer/` (the planet), `maze/` (a labyrinth carved into the buildable region) and
 * `stencil/` (a picture read as terrain), all building through `terrain-plan/`. Putting objects on
 * ground that already exists is `tools/placement/`, which the designer reaches through its door and
 * the macros and the assistant's tools reach without going through any generator.
 *
 * A run (`tools/generation/run/generation-run.ts`) and the Help figures call it through `index.ts`.
 */
import type { MacroCoord } from '../../core/model/types';
import { DEFAULT_RICHNESS, unknownAlgorithm, type ResolvedMazeGates, type GenerateConfig, type StencilBudgetOutcome } from './recipe';
import { generateMaze } from './maze/maze-generator';
import { generateStencil, type StencilRun } from './stencil/run';
import { printSpares } from './stencil/print-clear';
import { clearAllObjects, clearAllTerrain } from './terrain-plan/clear';
import type { GenerationContext, MapWriter } from './terrain-plan/types';
import { generateDesigned, type DesignedOutcome } from './designer';

/** The refusals a designed run collected, every kind counted. Zero on flat ground; a caller reports them. */
const refusedTotal = (out: DesignedOutcome): number =>
  Object.values(out.refused).reduce((sum, n) => sum + n, 0);

export interface GenerateResult {
  placed: number;
  skipped: number;
  overwritten: number;
  /** The designer run's plan and its refusal counts ('designed' algorithm only). */
  designed?: DesignedOutcome;
  /** Where the maze opened ('maze' algorithm only). The requested coordinates are snapped to the
   *  border ring, so a caller that marks the gates must read them back from here. */
  mazeGates?: ResolvedMazeGates;
  /** The one walk between the gates, over the run's own carved corridors and at their own width
   *  ('maze' only). */
  mazeWalk?: MacroCoord[];
  /** How an object stencil met its regional load budget ('stencil' only); absent when it fit. */
  stencilBudget?: StencilBudgetOutcome;
  /** Where a text run landed ('stencil' with a shape read). A caller reports it rather than letting
   *  a word arrive quietly shorter than it was typed. */
  stencil?: StencilRun['stencil'];
}

/**
 * Dispatch to the appropriate generator based on config.algorithm. Only the `designed` algorithm
 * consults `ctx.reg` directly: its placement stage commits objects through `tryPlace`, which
 * carries the registry in its context.
 */
export function generateTerrain(ctx: GenerationContext, config: GenerateConfig): GenerateResult {
  switch (config.algorithm) {
    case 'maze': {
      const { placed, skipped, gates, walk } = generateMaze(ctx, config);
      return { placed, skipped, overwritten: 0, mazeGates: gates, ...(walk ? { mazeWalk: walk } : {}) };
    }
    case 'stencil':
      // A picture the shell rasterized. Nothing here reaches for a canvas, which is what lets this
      // run in the candidate worker alongside every other kind.
      return { ...generateStencil(ctx, config.stencilPlan, config.maxElevation), overwritten: 0 };
    case 'designed': {
      const out = generateDesigned({
        state: ctx.state, execute: ctx.execute, reg: ctx.reg, seed: config.seed,
        richness: config.richness ?? DEFAULT_RICHNESS,
        maxElevation: config.maxElevation,
        mode: config.mode,
        region: config.region,
      });
      return { placed: out.placed, skipped: refusedTotal(out), overwritten: 0, designed: out };
    }
    default:
      return unknownAlgorithm(config);
  }
}

/**
 * Clear a run's scope before it builds: every unlocked object, then every terrain cell, in `region`
 * (the whole map when null). The clearing commands name the map's own objects, so a candidate never
 * replays them; landing re-derives them against the live map.
 */
export function clearForRun(ctx: MapWriter, region: readonly MacroCoord[] | null, config: GenerateConfig): void {
  clearAllObjects(ctx, { region, spare: printSpares(ctx.state, region, config) });
  clearAllTerrain(ctx, { region });
}
