/** The layer panel's plate and tile geometry, in css px, and the depths the rail plans it by. */
import { type LayerMode } from '../frame';
import { PANEL_EDGE_WIDTH } from '../../design/tokens';
import { TEXT } from '../units';
import { ELEVATION_MAX } from '../../../core/game/profile';

/**
 * The plate's own sizes in css px, one set for both sizes (what differs is the tile), judged against a
 * generated map whose ground floor carries five figures.
 */
export const PANEL = {
  /** Inside the plate's own edge. */
  pad: 12,
  /** The plate's hairline, in css px. Counted in `plateDepth` because the plate is `border-box`:
   *  the edge comes out of the height the column hands it, not off the outside of it. */
  edge: PANEL_EDGE_WIDTH,
  /** The air between the head and the first floor. */
  headGap: 10,
  /** Above and below the mark on a head pill, and either side of it. Both head controls take them,
   *  so the two ends of the head are one drawn size and neither outweighs the other. */
  headPadY: 5,
  headPadX: 9,
  /** The mark inside a head control, which the `#` also holds as its minimum so both controls read as a pair. */
  headGlyph: 15,
  /** Between the two size arrows, which are a pair and so stand closer to each other than either
   *  does to the layer-numbers toggle beside them. */
  arrowGap: 5,
  headSplitGap: 8,
  /** The plate's own corner, in the frame's px like every other length here. */
  radius: 20,
} as const;
/** What one floor's tile is built out of. Every length in css px. */
interface TileMetrics {
  padX: number;
  padY: number;
  /** Between two lines of one tile. */
  line: number;
  /** Between the band's chip and the floor's name, which is the chip's caption. */
  swatchGap: number;
  /** Between the count and whatever else shares its line: different kinds of thing, so they are
   *  separated by more than any one of them is internally. */
  readingGap: number;
  /** Between the eye and the lock, which are a pair and so sit closer than either does to the
   *  figure. */
  toggleGap: number;
  /** The band's colour, as a chip at the head of the tile. */
  swatch: number;
  /** Room for five figures, which is what a real map's ground floor carries, so the toggles hold
   *  their column across the whole stack and from one map to the next. */
  count: number;
  icon: number;
  /** The share bar's thickness, drawn the full width of the tile's content. */
  bar: number;
  radius: number;
  /** The air between tiles, following the tile's depth: it is the only thing separating floors. */
  gap: number;
}
/**
 * One floor's tile per size. The square has width to spare and depth to spend (name, count with the
 * toggles, bar on three lines); the file trades depth for width (words on one line). The bar keeps its
 * own line at both sizes, and a size's width is its longest line.
 */
export const TILE: Record<'grid' | 'column', TileMetrics> = {
  grid: {
    padX: 12, padY: 10, line: 8, swatchGap: 7, readingGap: 12, toggleGap: 5,
    swatch: 13, count: 38, icon: 22, bar: 8, radius: 14, gap: 10,
  },
  column: {
    padX: 11, padY: 5, line: 4, swatchGap: 6, readingGap: 10, toggleGap: 4,
    swatch: 12, count: 38, icon: 20, bar: 6, radius: 12, gap: 6,
  },
};
/** Width needed to keep all three header controls visible at either panel size. */
export const PLATE_MIN_WIDTH = 2 * (PANEL.pad + PANEL.edge + Math.max(TILE.grid.padX, TILE.column.padX))
  + 3 * (PANEL.headGlyph + 2 * PANEL.headPadX) + PANEL.arrowGap + PANEL.headSplitGap;
/** Which tile a size draws. The pill draws none, and takes the file's, since the file is what the
 *  count opens into. */
export const tileOf = (mode: LayerMode): TileMetrics => (mode === 'grid' ? TILE.grid : TILE.column);
/** Every floor the map can hold, which is what both sizes list. */
export const FLOORS = ELEVATION_MAX + 1;
/** How many floors a row holds: the square lays the stack out as square as it goes; the file is one. */
const GRID_COLS = Math.ceil(Math.sqrt(FLOORS));
export const colsOf = (mode: LayerMode) => (mode === 'grid' ? GRID_COLS : 1);
/** Every row the whole stack takes at this size, showing or not. */
const rowsOf = (mode: LayerMode) => Math.ceil(FLOORS / colsOf(mode));
/** One tile's depth, following its layout; a line is as tall as the toggle standing on it. */
function tileDepth(mode: LayerMode): number {
  const tile = tileOf(mode);
  const words = mode === 'grid'
    ? TEXT.tab + tile.line + tile.icon
    : Math.max(tile.icon, TEXT.tab);
  return 2 * tile.padY + words + tile.line + tile.bar;
}
/** The notes row's "?", drawn at `help` css px over the file's chip slot and centred on it. */
const HELP = 16;
/** The pinned plan-notes row between the head and the floors, one line at either size, counted in every
 *  depth. `helpMarginX` is how far the "?" overhangs the chip slot either side (negative). */
export const NOTES_ROW = { padY: 5, gap: 6, help: HELP, helpMarginX: (TILE.column.swatch - HELP) / 2 } as const;
/** The panel's leading column, from the plate's content edge: the head's numbers toggle, the notes row's
 *  "?" and every floor's chip start on it at both sizes. */
export const LEAD_X = TILE.column.padX + NOTES_ROW.helpMarginX;
/** How far a size's chip stands left of its tile's padding to start on the leading column; the name keeps its place. */
export const chipShift = (mode: LayerMode): number => LEAD_X - tileOf(mode).padX;
function notesRowDepth(): number {
  return 2 * NOTES_ROW.padY + Math.max(TILE.column.icon, TEXT.tab) + NOTES_ROW.gap;
}
/** What a plate drawing `rows` rows of floors at this size comes to: the head, the notes row, the
 *  rows, and the plate's own air and edge. */
function depthOf(mode: LayerMode, rows: number): number {
  return 2 * PANEL.edge + PANEL.pad + (2 * PANEL.headPadY + TEXT.head) + PANEL.headGap
    + notesRowDepth()
    + rows * tileDepth(mode) + (rows - 1) * tileOf(mode).gap + PANEL.pad;
}
/** What the whole stack takes at this size, every floor showing. Deeper than the plate draws
 *  wherever `plateDepth` shows fewer rows than the stack has, which is what the file scrolls. */
export function fullDepth(mode: LayerMode): number {
  return depthOf(mode, rowsOf(mode));
}
/** Natural depth of the grid with every floor visible. */
const SQUARE_DEPTH = fullDepth('grid');
/** Maximum whole column rows that fit within the grid's natural depth. */
function fileFloorsWithin(depth: number): number {
  let floors = 1;
  while (floors < FLOORS && depthOf('column', floors + 1) <= depth) floors++;
  return floors;
}
const FILE_FLOORS = fileFloorsWithin(SQUARE_DEPTH);
/** How many rows of floors a size actually draws: the square shows the whole stack, the file shows
 *  `FILE_FLOORS` of it. */
const shownRows = (mode: LayerMode) => (mode === 'grid' ? rowsOf(mode) : FILE_FLOORS);
/** Natural panel depth in CSS pixels; the rail may supply a smaller scrollable height. */
export function plateDepth(mode: LayerMode): number {
  return depthOf(mode, shownRows(mode));
}
/** The header, notes and one complete row remain visible when the floor list scrolls. */
export function plateMinDepth(mode: LayerMode): number {
  return depthOf(mode, 1);
}
/** The stack as the panel shows it: every floor, with how full of the map it is. */
export interface Row {
  elevation: number;
  name: string;
  count: number;
  /** How much of the map's buildable ground this floor covers, 0..1. */
  share: number;
}
