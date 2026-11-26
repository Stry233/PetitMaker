/*
 * The lived-in map a Help figure plays inside: the designed generator's own run on a template, with
 * the figure's plot taken back to the template by the editor's own Clear, so the action stands in a
 * built neighbourhood the way a player's building plot does. A scene's worlds are built from nothing
 * but the template, its plot and fixed constants, so the same build gives the same worlds on any
 * thread: `scene-world.worker.ts` builds them off the main thread and `scene-worlds.ts` keeps them.
 */
import { DOOR } from '../../core/game/profile';
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import { findTrait } from '../../core/model/traits';
import { getAllItems, getCatalogItem } from '../../state/catalog';
import { hasGate, objectRect } from '../../state/object-geometry';
import { footprintCells } from '../../core/grid/footprint';
import type { Rect } from '../../core/grid/rect';
import { templateTerrainAt } from '../../core/model/template';
import type { GridState, MacroCoord, TerrainType } from '../../core/model/types';
import { clearGenerated } from '../operations/generate';
import { SandboxWorld } from './demo-world';

/** Open cells between two rects, the larger of the two axes' gaps; 0 where they touch or overlap. */
function rectGap(a: Rect, b: Rect): number {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
}

/** One fixed designed run, as Generate hands it to the designer, so every visit sees the same neighbourhood. */
const SCENE_RECIPE = { seed: 20260830, richness: 0.9, maxElevation: 4, mode: 'mixed', region: null } as const;

/** Cells cleared around a plot: the deepest reach a rule has from a placement into its
 *  surroundings, a house's doorstep, which also covers the spacing a neighbour keeps and the cell a
 *  flat footprint's sweep reaches, so no rule reaches from the neighbourhood into the scene. */
const PLOT_MARGIN = Math.ceil(DOOR.riseDepth);

/** The cells a scene acts on, and the one-per-map items it places, which come off the neighbourhood
 *  so they stay free to place. */
export interface ScenePlot { cells: Rect; free: readonly string[] }

/** The name a scene's cleared plot is kept under. */
export const plotKeyOf = ({ cells, free }: ScenePlot): string => `${cells.x},${cells.y},${cells.w},${cells.h}|${free.join(',')}`;

/** The cells a scene's world clears for `cells`: the plot grown by the margin. */
export function plotClearing(cells: Rect): Rect {
  return { x: cells.x - PLOT_MARGIN, y: cells.y - PLOT_MARGIN, w: cells.w + 2 * PLOT_MARGIN, h: cells.h + 2 * PLOT_MARGIN };
}

/** A fresh map of `templateId` built out by the scenes' one designed run under the full rules. */
export function sceneNeighbourhood(templateId: string | undefined): GridState {
  const world = new SandboxWorld(templateId);
  world.beginStroke();
  world.generateDesigned(SCENE_RECIPE);
  world.commit();
  return world.state;
}

/** `base` with `plot` and its margin cleared, the neighbourhood's objects kept clear of the plot. */
export function scenePlot(base: GridState, plot: ScenePlot): GridState {
  return clearedPlot(base, plotClearing(plot.cells), plot.free, plot.cells);
}

/**
 * A copy of `base` with `plot` cleared as Clear takes back a region (every unlocked object touching
 * it and its terrain, the seam outside repaired), the template's own terrain laid back where the
 * clear left the ground bare, and every object of the `free` items removed wherever it stands, so a
 * capped item the figure places is still free to place.
 *
 * Given `keep`, the cells a scene acts on, the objects the clear took from outside it come back
 * through the real placement command, each only where the rules accept it on the cleared ground, so
 * the plot stands in its street: none within a cell of `keep`, none with a house's door, and one
 * with a spacing radius only as far from `keep` as the widest radius reaches, so no neighbour's rule
 * reaches into what the scene places; one the rules refuse (one that stood on cleared rock) stays
 * cleared.
 */
function clearedPlot(base: GridState, plot: Rect, free: readonly string[] = [], keep?: Rect): GridState {
  const world = new SandboxWorld(undefined, { base });
  const region = footprintCells(plot.x, plot.y, plot.w, plot.h)
    .filter(({ x, y }) => world.state.cells[y]?.[x] !== undefined);
  clearGenerated(world.kit, { region });
  const freed = new Set(free);
  for (const obj of [...world.state.objects.values()]) {
    if (freed.has(obj.catalogId)) world.execute(removeObjectCommand(obj));
  }
  const relay = new Map<string, { type: TerrainType; elevation: number; cells: MacroCoord[] }>();
  for (const c of region) {
    const cell = world.state.cells[c.y]![c.x]!;
    const laid = cell.terrain ? null : templateTerrainAt(base.template, c.x, c.y, cell.zone);
    if (!laid) continue;
    const key = `${laid.type}:${laid.elevation}`;
    const group = relay.get(key) ?? { type: laid.type, elevation: laid.elevation, cells: [] };
    group.cells.push(c);
    relay.set(key, group);
  }
  for (const g of [...relay.values()].sort((a, b) => a.elevation - b.elevation)) world.paint(g.cells, g.type, g.elevation);
  if (keep) {
    const widest = Math.max(0, ...getAllItems().map((i) => findTrait(i, 'exclusionRadius')?.radius ?? 0));
    for (const obj of base.objects.values()) {
      if (world.state.objects.has(obj.id) || freed.has(obj.catalogId)) continue;
      const item = getCatalogItem(obj.catalogId);
      if (!item || hasGate(item)) continue;
      const need = findTrait(item, 'exclusionRadius') ? Math.max(1, widest) : 1;
      if (rectGap(objectRect(obj, item), keep) < need) continue;
      world.execute(placeObjectCommand(obj));
    }
  }
  return world.state;
}
