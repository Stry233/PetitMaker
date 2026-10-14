/** draw_figure: iconic ground-water figures, symmetric by construction. */
import { paintTerrainCommand } from '../../core/model/command-build';
import { TerrainType, type Command } from '../../core/model/types';
import { cellSet } from '../../core/grid/grids';
import { TERRAIN_GRID } from '../../core/game/profile';
import { getCatalogItem, getOfferedItem, itemRole } from '../../state/catalog';
import { clipBuildable, clipOccupied } from './cells';
import { argError } from './feedback';
import { buildPlaceCmd } from './objects';
import { int, obj, oneOf, req, str } from './schema';
import { defineTool } from './spec';
import { runStroke } from './stroke';
import { regionClip } from './terraform';
import { FIGURE_SHAPES, figureCells, figureRing } from '../../tools/macros';
import { cellKey } from '../../core/grid/rect';
import { BUILDABLE_ZONES } from './game-terms';

/**
 * The built-in planets' iconic marks (a heart lake, a ring pond, a crescent) painted as ground water
 * with true symmetry, plus an optional single-species ring of trees or flowers around the outline,
 * as one deterministic call.
 */
export const drawFigureTool = defineTool({
  description: 'Paint an ICONIC ground-water figure with true symmetry: heart, ring or crescent, centered at cx,cy, size cells across. Optional ringId places a single-species ring of trees/flowers around the outline (the classic peach ring). For lettering and custom figures, compose cells yourself with paint_terrain (the figure-landscape skill has the rules).',
  input: obj({
    shape: req(oneOf([...FIGURE_SHAPES])),
    cx: req(int()),
    cy: req(int()),
    size: req(int({ min: 8, max: 48, description: 'Width in cells.' })),
    ringId: str({ description: 'Catalog id planted in a ring around the figure (one species; omit for bare water).' }),
    islandFor: str({ description: 'A building id to stand on a dry islet at the figure\'s heart (the house-in-a-pond set piece); the islet is sized for its footprint and margin, and a bridge reaches it via find_bridge_sites.' }),
  }),
  access: 'write',
  example: 'shape: "heart", cx: 110, cy: 70, size: 22',
  run(deps, input) {
    const { shape, cx, cy, size, ringId, islandFor } = input;
    const state = deps.getState();
    const { width: mw, height: mh } = state.template;
    // The spread is the tool's own, so it clips to an armed region like the organic terraformers do.
    const clip = regionClip(deps);
    const cells = figureCells(shape, cx, cy, size)
      .filter((c) => c.x >= 1 && c.y >= 1 && c.x < mw - 1 && c.y < mh - 1)
      .filter((c) => !clip || clip.has(cellKey(c.x, c.y)));
    const zoned = clipOccupied(clipBuildable(cells, deps.getState()).cells, deps.getState()).cells;
    if (zoned.length === 0) return argError(`the figure lies off the map, outside the selected region, or outside the buildable ${BUILDABLE_ZONES} zone; move cx,cy.`);
    if (zoned.length < cells.length) { cells.length = 0; cells.push(...zoned); }

    if (ringId && !getOfferedItem(ringId)) return argError(`unknown ringId "${ringId}", use a tree or flora id from the CATALOG section.`);
    // islandFor: keep a dry islet at the figure's heart, sized for the item plus the flat trait's
    // margin, and stand the item on it in the same stroke (the house-in-a-pond set piece).
    const islandItem = islandFor ? getCatalogItem(islandFor) : undefined;
    if (islandFor && !islandItem) return argError(`unknown islandFor "${islandFor}", use a building id from the CATALOG section.`);
    let waterCells = cells;
    let islandPlace: { x: number; y: number } | null = null;
    if (islandItem) {
      const iw = islandItem.width + 2, ih = islandItem.height + 2;
      if (size < Math.max(iw, ih) + 8) {
        return argError(`a ${islandItem.width}x${islandItem.height} islet home needs the figure at least ${Math.max(iw, ih) + 8} across (islet + margin + a real water ring); raise size.`);
      }
      let mx = 0, my = 0;
      for (const c of cells) { mx += c.x; my += c.y; }
      const icx = Math.round(mx / cells.length), icy = Math.round(my / cells.length);
      const ix1 = icx - Math.floor(iw / 2), iy1 = icy - Math.floor(ih / 2);
      const island = new Set<string>();
      for (let y = iy1; y < iy1 + ih; y++) for (let x = ix1; x < ix1 + iw; x++) island.add(cellKey(x, y));
      waterCells = cells.filter((c) => !island.has(cellKey(c.x, c.y)));
      islandPlace = { x: ix1 + 1, y: iy1 + 1 };
    }
    const commands: Command[] = [paintTerrainCommand(waterCells, TerrainType.Water, 0)];
    if (islandPlace && islandFor) {
      const cmd = buildPlaceCmd(deps, islandFor, { x: islandPlace.x, y: islandPlace.y }, 0);
      if (typeof cmd !== 'string') commands.push(cmd);
    }
    let ringWanted = 0;
    if (ringId) {
      // Cells of shoreline per placement: a tree ring breathes, a flower ring edges the shore.
      const gap = itemRole(getCatalogItem(ringId)) === 'groundcover' ? 1.2 : 3.2;
      const inside = new Set(cells.map((c) => cellKey(c.x, c.y)));
      const mirrored = figureRing(cells, shape, cx, gap);
      const seen = new Set<string>();
      for (const p of mirrored) {
        const key = cellKey(p.x, p.y);
        if (seen.has(key) || inside.has(key)) continue;
        if (p.x < 0 || p.y < 0 || p.x >= mw || p.y >= mh) continue;
        if (clip && !clip.has(key)) continue;
        seen.add(key);
        ringWanted++;
        const cmd = buildPlaceCmd(deps, ringId, { x: p.x, y: p.y }, 0);
        if (typeof cmd !== 'string') commands.push(cmd);
      }
    }
    return runStroke(
      deps,
      commands,
      (ok) => `Drew a ${shape} of ${waterCells.length} water cells at (${cx},${cy})`
        + `${islandPlace ? `; ${islandFor} stands on a dry islet at (${islandPlace.x},${islandPlace.y}) — find_bridge_sites near it for the way across` : ''}`
        + `${ringId ? `; ring: ${ringWanted} ${ringId} positions around it (${Math.max(0, ok - 1 - (islandPlace ? 1 : 0))} landed)` : ''}. The shape is symmetric by construction.`,
      { snapshot: cellSet(TERRAIN_GRID, waterCells) },
    );
  },
});
