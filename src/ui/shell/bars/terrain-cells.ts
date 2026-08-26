/*
 * terrain-cells.ts — the terrain bar's tool row, as data.
 *
 * The three terrain surfaces draw ONE row: draw, erase, trim, then the four shapes, then smart
 * build. Only the first two cells' glyphs differ between them, so the row is one table with a
 * per-surface glyph rather than three tables that would drift apart cell by cell.
 *
 * Every rect is in the design space the art was measured in (3754 x 1918 = `CANVAS`), exactly as
 * `frame.ts` places the frame, and the glyph rects are the extracted manifest's own numbers so a
 * redraw moves the art and its placement together. A glyph is composed of the layers the design
 * source drew it with: several of these controls are two or four shapes, and the extractor emits a
 * file per shape plus a group file that carries the plate as well, so the parts are what a cell can
 * paint over a plate it chooses.
 *
 * THE LINE AND CURVE HANDLES ARE DRAWN, NOT EXTRACTED, the way the road swatches below are. The
 * design source puts an ellipse at each end of both strokes and masks the line's bar to clear a
 * circle where each one sits, but those four layers carry no fill and no stroke, so they paint
 * nothing: Photoshop's own composite of the two cells is a bar cropped square at both ends and a
 * bare arc. The rects, the circle and the ring's outer edge are the document's; what the document
 * never says is how thick the ring is, and that is taken from the trim scissors' finger loops,
 * which are the one ring this row already draws at this radius (outer 21, inner 12 design px).
 *
 * EVERY GLYPH ALSO CARRIES ITS MEASURED INK, because the design's own drawings are not one size:
 * 绘制山体 is a single mass 106 x 81, 绘制地形 is four small shapes spanning 85 x 60, and the line
 * cell is a stroke covering 1062 design px squared where the mountain covers four times that. Drawn
 * at the sizes the document gives them, the row comes out with each cell a different weight. So the
 * bar sizes each one by what it READS as (`frame.ts:apparentSize`) and balances it on its own ink
 * (`opticalCentre`), which is the rule the rail already uses. The numbers are read off a raster of
 * the COMPOSED glyph, in the glyph's own local frame, the same way `frame.ts:GLYPHS` measures.
 */
import type { BuildMode, BuildShape, BuildTool } from '../../../core/model/edit-mode';
import type { Glyph, GlyphInk } from '../frame';
import { ACTIVE, INK, PLATE } from '../../design/tokens';
import { SCALE } from '../units';

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

/** The three surfaces that share this bar: every build mode that lays CONTENT on the map. Written
 *  as the exclusion rather than as three names so a new content surface reaches this bar as a type
 *  error rather than as a bar that silently does not offer it. */
export type TerrainSurface = Exclude<BuildMode, null | 'object' | 'generate'>;

/** The mode's terrain surface, or null for the modes whose bars are their own shape. */
export function terrainSurface(mode: BuildMode): TerrainSurface | null {
  return mode === 'mountain' || mode === 'water' || mode === 'road' ? mode : null;
}

/**
 * An endpoint handle of the line and curve strokes: an OPEN ring, at the design's own rect.
 *
 * `box` and `outer` are the ellipse the document places there, measured off it: a 26 design px
 * square holding a circle 20.375 across, the same four times over. `ring` is the only number the
 * document does not give, and it is the trim scissors' loops in this row's own proportion (12 of 21
 * left open), which lands within a tenth of a design px of 4.4 here.
 */
const HANDLE = { box: 26, outer: 20.375, ring: 4.4 } as const;

/** Where the document centres its two ellipses inside that box, a sixth of a design px apart. Each
 *  handle keeps its own, which also gives a cell's two rings separate art to be keyed by. */
const HANDLE_CENTRE = { lower: [13.08, 12.85], upper: [12.91, 13.15] } as const;

/*
 * A HANDLE SITS ON THE END OF THE STROKE IT TERMINATES, which is not where the document puts it.
 *
 * The ellipse layers carry zero FILL opacity (a separate property from layer opacity, and the one
 * Photoshop composites), so they draw nothing and the artist never saw where they landed. Taken
 * literally they leave the curve's two rings about 11 design px outboard of the arc's tips and 4
 * below them, floating clear of the stroke they belong to. The line's bar is masked to leave a
 * round gap at each end, which is the document's own evidence that a handle was meant to close it.
 *
 * So the rects below are the stroke's own end centres, less the ring's offset inside its box: the
 * bar's two cap centres, and the midpoints of the arc's two end faces.
 */

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

/**
 * A stroke ended at its own handles: the drawing, with a round gap opened where each ring closes it.
 *
 * THE GAPS HAVE TO BE CUT HERE BECAUSE THE HANDLES MOVED. The document masks the line's bar with
 * exactly this, at the ellipse rects it declares — but those rects are the ones the artist never
 * saw (zero fill opacity), and the rings now stand on the stroke's own end centres instead. Keeping
 * the drawing's holes would leave the upper one four design px from the ring meant to fill it,
 * showing as a bright crescent beside a ring that no longer closes anything. The arc has no mask at
 * all in the document, so without this its tips run on into their rings and fill them.
 *
 * One helper for both, so the hole and the ring are the same coordinate by construction rather than
 * by two tables agreeing. The radius is the ring's INNER edge, so the stroke stops where the ring
 * begins and the two read as one figure.
 */
const cutAtHandles = (
  src: string, w: number, h: number, at: readonly (readonly [number, number])[],
) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  + `<mask id="c" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">`
  + `<rect width="${w}" height="${h}" fill="#fff"/>`
  + at.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${HANDLE.outer / 2 - HANDLE.ring}" fill="#000"/>`).join('')
  + `</mask><image href="${src}" width="${w}" height="${h}" mask="url(#c)"/></svg>`,
)}`;

/** Each stroke's handle centres in ITS OWN art frame: the canvas rects below, less the art's own.
 *  Derived rather than measured, so moving a handle moves the hole that receives it. */
const handleIn = (
  artX: number, artY: number, rects: readonly HandleRect[],
): readonly (readonly [number, number])[] =>
  rects.map(([x, y, [cx, cy]]) => [x + cx - artX, y + cy - artY] as const);

/** A handle's rect on the design canvas, and where its circle sits inside the 26 px box. */
type HandleRect = readonly [number, number, readonly [number, number]];

/** The two strokes' handles, each on its own stroke's end centre: the bar's two cap centres, and the
 *  midpoints of the arc's two end faces. One declaration per cell, read by both the ring and the
 *  hole it stands in. */
const LINE_HANDLES: readonly [HandleRect, HandleRect] = [
  [771.8, 1786.6, HANDLE_CENTRE.lower],
  [817.1, 1763.5, HANDLE_CENTRE.upper],
];
const CURVE_HANDLES: readonly [HandleRect, HandleRect] = [
  [951.9, 1780.7, HANDLE_CENTRE.lower],
  [1012.1, 1779.9, HANDLE_CENTRE.upper],
];

/** One drawn layer of a glyph, at its design rect. */
export interface ArtPart {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ToolCell {
  id: string;
  /** Accessible name, and the name shown under the cell while it is the active one. */
  labelKey: string;
  /** The keyboard command that does the same thing. Its LIVE binding is the cell's badge, so a
   *  rebind shows on the bar without the bar knowing what the keys are. */
  commandId: string;
  /** What a click lays. `setEditMode` takes these two and resolves the tool; the shape cells all
   *  resolve to the same tool, which multiplexes the figure internally. */
  edit: { tool: BuildTool; shape?: BuildShape };
  /**
   * Whether this cell's stroke goes through the post-stroke corner trim, and so carries the
   * auto-trim setting in its plate while it is the active cell.
   *
   * Every cell that LAYS content does: the brush and the four shapes are one tool
   * (`tools/paint/drawing-tool.ts`), and its `finishStroke` runs `applyAutoEdgeCut` over whatever
   * the stroke committed, terrain and road alike. The eraser never calls it — it takes content
   * away, and there is no stroke to shape — and the trim cell IS the manual trimmer, so offering
   * the automatic one inside its own plate would be a control arguing with itself.
   */
  autoTrim?: true;
  /** Whether this cell carries the ERASER'S SHAPE setting while it is the active cell: only the
   *  eraser does, since it is the only tool whose press has more than one footprint to choose
   *  between (`tools/paint/eraser.ts`). */
  eraserShape?: true;
  /**
   * Whether this tool lays a figure the BRUSH SIZE decides the width of.
   *
   * The free brush, the eraser, the line and the curve do (`expandLine`/`splineCells`/`brushCells`
   * all take it); a rectangle and a circle are laid to the size they are dragged out to, and the
   * trimmer takes one corner. The row's slider reads this and draws itself unavailable where the
   * armed tool has no width for it to set.
   */
  sized?: true;
  glyph: Record<TerrainSurface, Glyph>;
}

/**
 * A drawing at the design's own absolute rects, turned into a glyph the bar can size and centre.
 *
 * The parts move into the drawing's OWN frame — its top-left corner, not the cell's — so the bar
 * never has to know where on the 3754 x 1918 canvas the artist put it. `ink` is measured in that
 * same frame, which is what makes the two comparable.
 */
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
function shared(glyph: Glyph): Record<TerrainSurface, Glyph> {
  return { mountain: glyph, water: glyph, road: glyph };
}

/** The nominal cell box. The row is a fixed pitch of these; an ACTIVE cell draws a bigger plate
 *  around the same box rather than taking more room, so selecting one never moves the others. */
export const CELL = { y: 1729, w: 166, h: 115 } as const;

/**
 * How big every glyph in the row READS, in design px.
 *
 * Near the size the design's own eleven drawings average, so the row keeps the weight the document
 * gives it and only the SPREAD goes: the mountain mass reads at 91 where the trim scissors read at
 * 51, and a row whose members differ that far draws the same tool at plainly different sizes on 山体
 * and 路面. It stays at 62 rather than tracking that average, which drawing
 * the line and curve handles lifted to 67: following it would grow the nine cells nobody asked about.
 */
export const GLYPH = 62;

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
 * The plate's own right edge, as a css `right` against the cell box, in css px.
 *
 * A grown pill ENDS at the control it holds, so its right edge is the cell box's; every other plate
 * is centred on that box and so hangs `PLATE_PAD.x` past it.
 *
 * IT IS A FUNCTION BECAUSE THE BADGE READS IT TOO. A shortcut badge sits on this corner, so the one
 * thing it must never do is name its own number: pinned at a constant the badge stays put while
 * the pill opens around it. Given the edge, css follows any width for
 * free, since the cell box grows with the control inside it.
 */
export function plateRight(active: boolean, grown: boolean): number {
  return active && !grown ? -PLATE_PAD.x : 0;
}

/**
 * The plate, in every state a cell wears it: how far it reaches past the cell box on each side, and
 * what it is filled with.
 *
 * ONE DESCRIPTION, FIVE NUMBERS, so the shapes are the same object and a press animates between
 * them. The plate is the cell box at rest, the design's bigger pill when the cell is chosen, and a
 * pill grown rightward around a control when the chosen cell carries one. Separate renderings of
 * those states could only ever swap; one shape animates.
 */
export function plateShape(active: boolean, grown: boolean): Record<string, number | string> {
  const x = active ? PLATE_PAD.x : 0;
  const y = active ? PLATE_PAD.y : 0;
  return {
    left: -x, top: -y, bottom: -y, right: plateRight(active, grown),
    backgroundColor: active ? ACTIVE : PLATE,
  };
}

/**
 * The shortcut badge, on the cell's top-right corner: the drawing's own box, and how far it stands
 * above the cell's top edge.
 *
 * `w` is a MINIMUM. The design drew a single letter; a rebound command can carry "Ctrl+B", and a
 * badge is as wide as the keys it names, like every other label in this frame.
 *
 * The badge is anchored by its RIGHT edge to the PLATE's (`plateRight`), so it follows a pill of any
 * width and a wider combo grows into the plate rather than off it. There is no inset: measured in
 * the browser, a badge whose right edge lands on the plate's own leaves its bottom-right corner 4 px
 * past the cap arc, which is the overlap that reads as attached. The two nearby numbers are both
 * wrong. The design's is 19 design px PAST the cell's right edge, and a cell
 * plate is a stadium: by the badge's row the surface has curved away, so the badge floats clear of
 * the shape it belongs to. Pulling it back to where the arc reaches the badge's bottom edge — the
 * furthest right it can stand and still only TOUCH the plate — stops it short of the corner instead.
 */
export const BADGE = { rise: CELL.y - 1711, w: 44, h: 44 } as const;

/** The active cell's name, under it and on the map: where the design puts its top, which is just
 *  clear of the grown plate's own bottom edge. */
export const CAPTION = { y: 1858 } as const;

/** The brush-size slider. `first`/`last` are the tick centres the knob's centre travels between;
 *  the range is 1 to 5 (the drawing's three dots are tick marks, not the number of steps). */
export const BRUSH = {
  track: { x: 3210, y: 1765, w: 454, h: 79 },
  tick: 22,
  knob: 96,
  pip: 31,
  first: 3261,
  last: 3613,
  centreY: 1804,
  readoutRight: 3197,
  readoutSize: 44.4,
  min: 1,
  max: 5,
} as const;

/**
 * The road-surface swatches, in design px, from the drawing the design source puts above 路面's
 * tool row (`路面下边栏/路面`, four tiles at a 172 pitch starting at the row's own left edge).
 *
 * DRAWN, not the extracted art. Each tile is an outer rounded square with a smaller one inset, and
 * the inner one is the SURFACE's own colour, which is a catalog fact — the document drew all four
 * the same brown, because on that canvas they were a placeholder. So the bar draws both squares and
 * fills the inner from the live catalog, which is also what lets a fifth surface arrive with no art
 * and no edit here. `radius` is the drawing's own corner, and the inner square takes the same
 * PROPORTION of its smaller side rather than the same number of pixels.
 */
export const ROAD_STYLE = { size: 151, pitch: 172, inset: 10, radius: 22 } as const;

/** The one plate that is still a drawing: a rounded square, where the cell plates are pills the
 *  bar fills itself (so an active one takes the shared active yellow rather than the drawing's). */
export const PLATE_ART = { badge: badgePlate };

export const TOOL_CELLS: readonly ToolCell[] = [
  {
    id: 'draw', labelKey: 'design.free_brush', commandId: 'tool.brush',
    sized: true,
    edit: { tool: 'brush' },
    autoTrim: true,
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
    id: 'erase', labelKey: 'design.eraser', commandId: 'tool.eraser',
    sized: true,
    edit: { tool: 'erase' },
    eraserShape: true,
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
    id: 'trim', labelKey: 'design.edge_cut', commandId: 'tool.edgecut',
    edit: { tool: 'trim' },
    glyph: shared(toGlyph(
      { x: 2, y: 2, w: 54, h: 53, gx: 30.02, gy: 28.97, area: 1222.8 },
      [{ src: trimShape, x: 569, y: 1756, w: 57, h: 59 }],
    )),
  },
  {
    id: 'line', labelKey: 'design.line_brush', commandId: 'tool.line',
    sized: true,
    edit: { tool: 'shape', shape: 'line' },
    autoTrim: true,
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
    id: 'curve', labelKey: 'design.curve_brush', commandId: 'tool.curve',
    sized: true,
    edit: { tool: 'shape', shape: 'curve' },
    autoTrim: true,
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
    id: 'rect', labelKey: 'design.rect_brush', commandId: 'tool.rect',
    edit: { tool: 'shape', shape: 'rect' },
    autoTrim: true,
    glyph: shared(toGlyph(
      { x: 2, y: 2, w: 61, h: 61, gx: 32.5, gy: 32.5, area: 1806.4 },
      [{ src: rectShape, x: 1143, y: 1755, w: 64, h: 64 }],
    )),
  },
  {
    id: 'circle', labelKey: 'design.circle_brush', commandId: 'tool.circle',
    edit: { tool: 'shape', shape: 'circle' },
    autoTrim: true,
    glyph: shared(toGlyph(
      { x: 2, y: 2, w: 67, h: 67, gx: 35.05, gy: 35.05, area: 1861.5 },
      [{ src: circleShape, x: 1323, y: 1750, w: 70, h: 70 }],
    )),
  },
];

/**
 * Which cell reads as the active one, from the edit-mode inputs the store holds.
 *
 * Derived rather than stored: the same facts drive the map, and a second copy of "which tool is
 * armed" beside the store's would be a second thing to keep in step. `none` (a selection gesture
 * left the surface without a tool) lights nothing, which is the honest picture.
 */
export function activeCellId(tool: BuildTool, shape: BuildShape): string | null {
  if (tool === 'shape') return TOOL_CELLS.find((c) => c.edit.shape === shape)?.id ?? null;
  return TOOL_CELLS.find((c) => c.edit.tool === tool)?.id ?? null;
}
