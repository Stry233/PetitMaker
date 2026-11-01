/**
 * The worlds a scene stands in, built from nothing but the template and fixed constants, so the
 * same build gives the same worlds on any thread: the designed neighbourhood and each plot cleared
 * in it. `scene-world.worker.ts` builds them off the main thread; `context.ts` keeps them.
 */
import type { GridState } from '../../../../core/model/types';
import { DOOR } from '../../../../core/game/profile';
import { clearedPlot, designedNeighbourhood, type NeighbourhoodRecipe } from '../../../../editor/sandbox/neighbourhood';
import { CABIN, CABIN2, type Plot } from './common';

/** One fixed designed run, so every visit sees the same neighbourhood. */
const RECIPE: NeighbourhoodRecipe = { seed: 20260830, richness: 0.9, maxElevation: 4, mode: 'mixed', region: null };

/** Cells cleared around a plot: the deepest reach a rule has from a placement into its
 *  surroundings, a house's doorstep, which also covers the spacing a neighbour keeps and the cell a
 *  flat footprint's sweep reaches, so no rule reaches from the neighbourhood into the scene. */
const PLOT_MARGIN = Math.ceil(DOOR.riseDepth);

/** The one-per-map items the scenes place, taken off the neighbourhood so they stay free to place. */
const PLACED_CAPPED = [CABIN, CABIN2];

/** The cells a scene's world clears for `plot`: the plot grown by the margin, in template cells. */
export function plotClearing(plot: Plot): Plot {
  return { x1: plot.x1 - PLOT_MARGIN, y1: plot.y1 - PLOT_MARGIN, x2: plot.x2 + PLOT_MARGIN, y2: plot.y2 + PLOT_MARGIN };
}

/** `templateId` built out by the designed generator. */
export function buildNeighbourhood(templateId: string | undefined): GridState {
  return designedNeighbourhood(templateId, RECIPE);
}

export const plotKeyOf = (plot: Plot): string => `${plot.x1},${plot.y1},${plot.x2},${plot.y2}`;

/** `base` with `plot` and its margin cleared, the neighbourhood's objects kept clear of `plot`. */
export function clearPlot(base: GridState, plot: Plot): GridState {
  const c = plotClearing(plot);
  return clearedPlot(
    base, { x: c.x1, y: c.y1, w: c.x2 - c.x1 + 1, h: c.y2 - c.y1 + 1 }, PLACED_CAPPED,
    { x: plot.x1, y: plot.y1, w: plot.x2 - plot.x1 + 1, h: plot.y2 - plot.y1 + 1 },
  );
}

