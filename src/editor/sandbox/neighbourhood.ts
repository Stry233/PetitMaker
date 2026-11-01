/*
 * The lived-in map a Help figure plays inside: the designed generator's own run on a template, with
 * the figure's plot taken back to the template by the editor's own Clear, so the action stands in a
 * built neighbourhood the way a player's building plot does.
 */
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import { findTrait } from '../../core/model/traits';
import { getAllItems, getCatalogItem } from '../../state/catalog';
import { hasGate, objectRect } from '../../state/object-geometry';
import { footprintCells } from '../../core/grid/footprint';
import type { Rect } from '../../core/grid/rect';
import { templateTerrainAt } from '../../core/model/template';
import type { GridState, MacroCoord, TerrainType } from '../../core/model/types';
import type { DesignedContext } from '../../tools/generation/designer';
import { clearGenerated } from '../operations/generate';
import { SandboxWorld } from './demo-world';

/** A designed run's recipe, as Generate hands it to the designer. */
export type NeighbourhoodRecipe = Omit<DesignedContext, 'state' | 'execute' | 'reg'>;

/** Open cells between two rects, the larger of the two axes' gaps; 0 where they touch or overlap. */
function rectGap(a: Rect, b: Rect): number {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
}

/** A fresh map of `templateId` built out by the designed generator under the full rules. */
export function designedNeighbourhood(templateId: string | undefined, recipe: NeighbourhoodRecipe): GridState {
  const world = new SandboxWorld(templateId);
  world.beginStroke();
  world.generateDesigned(recipe);
  world.commit();
  return world.state;
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
export function clearedPlot(base: GridState, plot: Rect, free: readonly string[] = [], keep?: Rect): GridState {
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
