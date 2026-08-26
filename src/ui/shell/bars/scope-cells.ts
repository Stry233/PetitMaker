/*
 * scope-cells.ts — the scope screen's tool row, as data.
 *
 * IT IS THE TERRAIN BAR'S ROW, minus the trimmer. Painting a region is drawing: the same six
 * figures, at the same cell size, under the same shortcut keys — so a visitor who has painted
 * mountains already knows this row, and the two are one table rather than two that drift.
 *
 * THE DRAWINGS ARE THE ROAD SURFACE'S. A region is a patch of CELLS, and the road tools are the
 * flat-tile picture of exactly that; the mountain pair would say "paint a mountain" over a control
 * that paints no terrain at all. The four shape cells are surface-agnostic in the source table, so
 * the choice only really names the first two.
 */
import type { RegionTool } from '../../../core/model/types';
import type { Glyph } from '../frame';
import { TOOL_CELLS } from './terrain-cells';

export interface ScopeCell {
  tool: RegionTool;
  labelKey: string;
  commandId: string;
  glyph: Glyph;
  /** Whether this figure is laid to the brush's width. A rectangle and a circle are laid to the
   *  size they are dragged out to, so the slider has nothing to set while one of them is armed. */
  sized?: true;
}

/** The terrain row's own cell, by id: one table, read twice. */
function from(id: string): { labelKey: string; commandId: string; glyph: Glyph } {
  const cell = TOOL_CELLS.find((c) => c.id === id);
  if (!cell) throw new Error(`no tool cell ${id}`);
  return { labelKey: cell.labelKey, commandId: cell.commandId, glyph: cell.glyph.road };
}

/**
 * Which region figures a generate kind can actually work in.
 *
 * A PICTURE and a LETTER are both fitted to the region's BOUNDING BOX and read cell for cell, so a
 * figure whose box is bigger than itself loses whatever falls outside the painted shape. For the two
 * figures a drag produces whole — a rectangle, and a circle inscribed in its own box — that is a
 * vignette rather than damage: the picture keeps its middle and gives up its corners, which is a
 * composition somebody may well want and was offered here before. What neither can use is a figure
 * with no interior to speak of (a brushed blob, a line, a curve), where the box is mostly empty and
 * the result is a picture with holes through it.
 *
 * Offered rather than validated: a brush that cannot produce a usable region should not be on the
 * row, since the alternative is a stroke that is accepted and then quietly ignored.
 */
export const SCOPE_TOOLS_FOR: Readonly<Record<string, readonly RegionTool[] | undefined>> = {
  image: ['rect', 'circle'],
  text: ['rect', 'circle'],
};

export const SCOPE_CELLS: readonly ScopeCell[] = [
  { tool: 'brush', ...from('draw'), sized: true },
  { tool: 'eraser', ...from('erase'), sized: true },
  { tool: 'line', ...from('line'), sized: true },
  { tool: 'curve', ...from('curve'), sized: true },
  { tool: 'rect', ...from('rect') },
  { tool: 'circle', ...from('circle') },
];

/** Which `DesignMode` a tool key names, as a region tool: the keys are the terrain row's, so while
 *  the scope screen is up they pick the region's own figure instead of a build tool. */
export const REGION_TOOL_FOR: Readonly<Record<string, RegionTool>> = {
  brush: 'brush', eraser: 'eraser', line: 'line', curve: 'curve', rect: 'rect', circle: 'circle',
};
