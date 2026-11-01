/*
 * The tool-row data for the mountain, water and road surfaces, in the shell's design coordinates, and
 * the depth of each tool bar standing on such a row.
 * Composite glyphs keep their source layers; line and curve handles are drawn, their source ellipses
 * being unpainted. Measured ink keeps unlike glyphs balanced (`apparentSize`, `opticalCentre`).
 */
import type { BuildMode, BuildShape, BuildTool, ContentType } from '../../../state/editing/edit-mode';
import type { Glyph, GlyphInk } from '../frame';
import { INK, MASK_CUT, MASK_KEEP } from '../../design/tokens';
import { QUAD, SCALE } from '../units';
import { META_BY_ID, type CommandId } from '../../../state/keymap/registry';
import type { I18nKey } from '../../../i18n/keys';

import badgePlate from '../../../assets/shell/shelf-mountain/tools/roundrect-3.svg';

import drawMountain from '../../../assets/shell/shelf-mountain/tools/draw-mountain.svg';
import eraseMountain from '../../../assets/shell/shelf-mountain/tools/erase-mountain.svg';
import drawWater from '../../../assets/shell/shelf-water/tools/draw-water.svg';
import eraseWater from '../../../assets/shell/shelf-water/tools/erase-water.svg';
import drawRoad1 from '../../../assets/shell/shelf-road/tools/draw-road/roundrect-2.svg';
import drawRoad2 from '../../../assets/shell/shelf-road/tools/draw-road/roundrect-3.svg';
import drawRoad3 from '../../../assets/shell/shelf-road/tools/draw-road/roundrect-4.svg';
import drawRoad4 from '../../../assets/shell/shelf-road/tools/draw-road/roundrect-5.svg';
import eraseRoad1 from '../../../assets/shell/shelf-road/tools/erase-road/roundrect-2.svg';
import eraseRoad2 from '../../../assets/shell/shelf-road/tools/erase-road/roundrect-3.svg';
import eraseRoad3 from '../../../assets/shell/shelf-road/tools/erase-road/roundrect-4.svg';
import eraseRoad4 from '../../../assets/shell/shelf-road/tools/erase-road/roundrect-5.svg';
import trimShape from '../../../assets/shell/shelf-mountain/tools/trim/shape.svg';
import lineBar from '../../../assets/shell/shelf-mountain/tools/line/roundrect-2.svg';
import curveArc from '../../../assets/shell/shelf-mountain/tools/curve/rect.svg';
import rectShape from '../../../assets/shell/shelf-mountain/tools/rect-tool/roundrect-2.svg';
import circleShape from '../../../assets/shell/shelf-mountain/tools/circle-tool/ellipse.svg';
import { BRUSH_SIZE, isContentMode } from '../../../state/editing/edit-mode';

/** The mode's terrain surface, which shares the terrain tool row, or null for the modes whose bars
 *  are their own shape. */
export function terrainSurface(mode: BuildMode): ContentType | null {
  return isContentMode(mode) ? mode : null;
}

/** Open endpoint-ring dimensions in design pixels. */
const HANDLE = { box: 26, outer: 20.375, ring: 4.4 } as const;

/** Where the document centres its two ellipses inside that box, a sixth of a design px apart. Each
 *  handle keeps its own, which also gives a cell's two rings separate art to be keyed by. */
const HANDLE_CENTRE = { lower: [13.08, 12.85], upper: [12.91, 13.15] } as const;

/* Invisible source handles are aligned to the stroke endpoints: bar cap centres and arc end faces. */

/** The ring as a part `GlyphIcon` can place, in the ink every glyph in this row is drawn in. A
 *  stroke straddles its own path, so the radius is the outer edge less half the ring's width. */
const handleRing = (cx: number, cy: number) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${HANDLE.box} ${HANDLE.box}">`
  + `<circle cx="${cx}" cy="${cy}" r="${(HANDLE.outer - HANDLE.ring) / 2}"`
  + ` fill="none" stroke="${INK}" stroke-width="${HANDLE.ring}"/></svg>`,
)}`;

/** A handle filling the design rect its ellipse occupies. */
const handleAt = (x: number, y: number, [cx, cy]: readonly [number, number]): ArtPart =>
  ({ src: handleRing(cx, cy), x, y, w: HANDLE.box, h: HANDLE.box });

/** Cuts each stroke at the same coordinates used for its endpoint rings. */
const cutAtHandles = (
  src: string, w: number, h: number, at: readonly (readonly [number, number])[],
) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  + `<mask id="c" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">`
  + `<rect width="${w}" height="${h}" fill="${MASK_KEEP}"/>`
  + at.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${HANDLE.outer / 2 - HANDLE.ring}" fill="${MASK_CUT}"/>`).join('')
  + `</mask><image href="${src}" width="${w}" height="${h}" mask="url(#c)"/></svg>`,
)}`;

/** Each stroke's handle centres in its own art frame: the canvas rects below, less the art's own.
 *  Derived rather than measured, so moving a handle moves the hole that receives it. */
const handleIn = (
  artX: number, artY: number, rects: readonly HandleRect[],
): readonly (readonly [number, number])[] =>
  rects.map(([x, y, [cx, cy]]) => [x + cx - artX, y + cy - artY] as const);

/** A handle's rect on the design canvas, and where its circle sits inside the 26 px box. */
type HandleRect = readonly [number, number, readonly [number, number]];

/** The two strokes' handles on their own ends' centres, read by both the ring and the hole it stands in. */
const LINE_HANDLES: readonly [HandleRect, HandleRect] = [
  [771.8, 1786.6, HANDLE_CENTRE.lower],
  [817.1, 1763.5, HANDLE_CENTRE.upper],
];
const CURVE_HANDLES: readonly [HandleRect, HandleRect] = [
  [951.9, 1780.7, HANDLE_CENTRE.lower],
  [1012.1, 1779.9, HANDLE_CENTRE.upper],
];

/** One drawn layer of a glyph, at its design rect. */
interface ArtPart {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ToolCell {
  id: string;
  /** The toolbar tool and figure this cell stands for: what the row shows active when it is posed. */
  shows: { tool: BuildTool; shape?: BuildShape };
  /** The command that arms this cell; `commandLabel` names the cell after it. */
  commandId: CommandId;
  glyph: Record<ContentType, Glyph>;
}

/** A drawing at the design's absolute rects as a glyph in its own frame, where its ink is measured too. */
function toGlyph(ink: GlyphInk, parts: readonly ArtPart[]): Glyph {
  const x0 = Math.min(...parts.map((p) => p.x));
  const y0 = Math.min(...parts.map((p) => p.y));
  return {
    w: Math.max(...parts.map((p) => p.x + p.w)) - x0,
    h: Math.max(...parts.map((p) => p.y + p.h)) - y0,
    ink,
    parts: parts.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 })),
  };
}

/** A glyph the three surfaces share. */
function shared(glyph: Glyph): Record<ContentType, Glyph> {
  return { mountain: glyph, water: glyph, road: glyph };
}

/** The nominal cell box. The row is a fixed pitch of these; an `ACTIVE` cell draws a bigger plate
 *  around the same box rather than taking more room, so selecting one never moves the others. */
const CELL = { y: 1729, w: 166, h: 115 } as const;
/** The cell as it lands on screen, in css px. */
export const CELL_BOX = { w: CELL.w * SCALE, h: CELL.h * SCALE } as const;

/** How far the active cell's plate grows past the nominal box, per the design's own two plates. */
export const ACTIVE_PLATE = { dx: 12, dy: 8, w: 190, h: 132 } as const;

/** That plate's height as it lands on screen, in css px: the pill a cell carrying a control grows
 *  into is the same height, and what stands inside it is measured against this. */
export const PILL_H = ACTIVE_PLATE.h * SCALE;

/** How far the active cell's plate reaches past its own box, in css px. The vertical half is derived
 *  rather than read off `ACTIVE_PLATE.dy`, whose drawing is a design px deeper below than above. */
export const PLATE_PAD = {
  x: ACTIVE_PLATE.dx * SCALE,
  y: (PILL_H - CELL.h * SCALE) / 2,
} as const;

/**
 * The plate's right edge against the cell box, in css px: a grown pill ends at its control, others hang
 * `PLATE_PAD.x` past; the shortcut badge reads it, so it follows any width.
 */
export function plateRight(active: boolean, grown: boolean): number {
  return active && !grown ? -PLATE_PAD.x : 0;
}

/**
 * The shortcut badge on the cell's top-right corner: `w` is a minimum (a badge is as wide as its keys),
 * and its right edge on the plate's leaves it touching the cap arc.
 */
export const BADGE = { rise: CELL.y - 1711, w: 44, h: 44 } as const;

/** The brush-size slider. `first`/`last` are the tick centres the knob's centre travels between;
 *  the range is `BRUSH_SIZE` (the drawing's three dots are tick marks, not the number of steps). */
export const BRUSH = {
  track: { x: 3210, y: 1765, w: 454, h: 79 },
  tick: 22,
  knob: 96,
  pip: 31,
  first: 3261,
  last: 3613,
  centreY: 1804,
  ...BRUSH_SIZE,
} as const;

/**
 * The road-surface swatches in design px, drawn rather than placed: the inner square takes the surface's
 * catalog colour, so a new surface needs no art.
 */
export const ROAD_STYLE = { size: 151, pitch: 172, inset: 10, radius: 22 } as const;

/** The air between a row stacked over the tool row and the row under it, in css px. */
export const SWATCH_ROW_GAP = 20;
/** The foot of the first row stacked over the tool row, above the window's foot, in css px. */
export const SWATCH_ROW_BOTTOM = QUAD.bottom + CELL_BOX.h + SWATCH_ROW_GAP;
/** A swatch tile's side as it lands on screen, in css px. */
export const SWATCH_TILE = ROAD_STYLE.size * SCALE;
/** A notes tag pill's height: a line of lettering, so it stands lower than a swatch tile. */
export const TAG_H = SWATCH_TILE * 0.6;

/**
 * How far each tool bar's resting ink reaches above the window's foot on a wide window, in css px: the
 * tool row to its shortcut badges' tops, a material strip over it, and the notes bar's colour strip and
 * tag row. An active plate's growth and a removal badge stay inside the air a surface over the bar keeps.
 */
export const BAR_DEPTH = {
  tools: QUAD.bottom + CELL_BOX.h + BADGE.rise * SCALE,
  strip: SWATCH_ROW_BOTTOM + SWATCH_TILE,
  notes: SWATCH_ROW_BOTTOM + SWATCH_TILE + SWATCH_ROW_GAP + TAG_H,
} as const;

/** Whether a surface's bar in the map editor stands a material strip over its tool row: road lays a
 *  chosen paving, terrain lays its own. */
const MATERIAL_STRIP: Readonly<Record<ContentType, boolean>> = { mountain: false, water: false, road: true };

/** The tool bar `mode` stands up, or null for a mode whose bar is a shelf and for rest, which has none. */
export function toolBarOf(mode: BuildMode): keyof typeof BAR_DEPTH | null {
  const surface = terrainSurface(mode);
  if (surface) return MATERIAL_STRIP[surface] ? 'strip' : 'tools';
  return mode === 'annotate' ? 'notes' : null;
}

/** The one plate that is still a drawing: a rounded square, where the cell plates are pills the
 *  bar fills itself (so an active one takes the shared active yellow rather than the drawing's). */
export const PLATE_ART = { badge: badgePlate };

export const TOOL_CELLS: readonly ToolCell[] = [
  {
    id: 'draw',
    shows: { tool: 'brush' },
    commandId: 'tool.brush',
    glyph: {
      mountain: toGlyph(
        { x: 2, y: 5, w: 103, h: 75, gx: 59.31, gy: 52.79, area: 4216.4 },
        [{ src: drawMountain, x: 127, y: 1740, w: 106, h: 81 }],
      ),
      water: toGlyph(
        { x: 3, y: 2, w: 90, h: 65.13, gx: 44.94, gy: 38.76, area: 2137.7 },
        [{ src: drawWater, x: 139, y: 1747, w: 94, h: 69 }],
      ),
      road: toGlyph(
        { x: 2, y: 2, w: 77, h: 56, gx: 43.1, gy: 29.45, area: 1511.1 },
        [
          { src: drawRoad1, x: 142, y: 1777, w: 38, h: 26 },
          { src: drawRoad2, x: 164, y: 1790, w: 38, h: 26 },
          { src: drawRoad3, x: 164, y: 1762, w: 63, h: 41 },
          { src: drawRoad4, x: 197, y: 1756, w: 25, h: 25 },
        ],
      ),
    },
  },
  {
    id: 'erase',
    shows: { tool: 'erase' },
    commandId: 'tool.erase',
    glyph: {
      mountain: toGlyph(
        { x: 2, y: 7.88, w: 103, h: 72.13, gx: 58.38, gy: 54.27, area: 4062.4 },
        [{ src: eraseMountain, x: 345, y: 1740, w: 106, h: 81 }],
      ),
      water: toGlyph(
        { x: 3, y: 7.38, w: 83, h: 49.75, gx: 40.37, gy: 31.97, area: 1893.5 },
        [{ src: eraseWater, x: 346, y: 1757, w: 91, h: 59 }],
      ),
      road: toGlyph(
        { x: 2, y: 4, w: 77, h: 48, gx: 41.48, gy: 24.52, area: 1418.6 },
        [
          { src: eraseRoad1, x: 353, y: 1777, w: 38, h: 26 },
          { src: eraseRoad2, x: 375, y: 1790, w: 38, h: 26 },
          { src: eraseRoad3, x: 375, y: 1762, w: 63, h: 41 },
          { src: eraseRoad4, x: 408, y: 1764, w: 25, h: 9 },
        ],
      ),
    },
  },
  {
    id: 'trim',
    shows: { tool: 'trim' },
    commandId: 'tool.trim',
    glyph: shared(toGlyph(
      { x: 2, y: 2, w: 54, h: 53, gx: 30.02, gy: 28.97, area: 1222.8 },
      [{ src: trimShape, x: 569, y: 1756, w: 57, h: 59 }],
    )),
  },
  {
    id: 'line',
    shows: { tool: 'shape', shape: 'line' },
    commandId: 'tool.line',
    glyph: shared(toGlyph(
      { x: 2.88, y: 3, w: 65.5, h: 43.13, gx: 36, gy: 24.25, area: 794.5 },
      [
        { src: cutAtHandles(lineBar, 70, 48, handleIn(773, 1764, LINE_HANDLES)), x: 773, y: 1764, w: 70, h: 48 },
        handleAt(...LINE_HANDLES[0]),
        handleAt(...LINE_HANDLES[1]),
      ],
    )),
  },
  {
    id: 'curve',
    shows: { tool: 'shape', shape: 'curve' },
    commandId: 'tool.curve',
    glyph: shared(toGlyph(
      { x: 2.88, y: 2, w: 80.38, h: 42.75, gx: 43.13, gy: 24.13, area: 1202.2 },
      [
        { src: cutAtHandles(curveArc, 72, 40, handleIn(959, 1759, CURVE_HANDLES)), x: 959, y: 1759, w: 72, h: 40 },
        handleAt(...CURVE_HANDLES[0]),
        handleAt(...CURVE_HANDLES[1]),
      ],
    )),
  },
  {
    id: 'rect',
    shows: { tool: 'shape', shape: 'rect' },
    commandId: 'tool.rect',
    glyph: shared(toGlyph(
      { x: 2, y: 2, w: 61, h: 61, gx: 32.5, gy: 32.5, area: 1806.4 },
      [{ src: rectShape, x: 1143, y: 1755, w: 64, h: 64 }],
    )),
  },
  {
    id: 'circle',
    shows: { tool: 'shape', shape: 'circle' },
    commandId: 'tool.circle',
    glyph: shared(toGlyph(
      { x: 2, y: 2, w: 67, h: 67, gx: 35.05, gy: 35.05, area: 1861.5 },
      [{ src: circleShape, x: 1323, y: 1750, w: 70, h: 70 }],
    )),
  },
];

/** The tool cell `id` names; a missing id is a programming error. */
export function toolCell(id: string): ToolCell {
  const cell = TOOL_CELLS.find((c) => c.id === id);
  if (!cell) throw new Error(`No tool cell ${id}`);
  return cell;
}

/** The command of the free figure, which has no cell: its option is drawn as a loose stroke. */
export const FREE_SHAPE_COMMAND: CommandId = 'tool.free';

/** What a cell or option arming `command` is called: the keymap registry's name for that command. */
export function commandLabel(command: CommandId): I18nKey {
  const meta = META_BY_ID.get(command);
  if (!meta) throw new Error(`No command ${command}`);
  return meta.labelKey;
}
