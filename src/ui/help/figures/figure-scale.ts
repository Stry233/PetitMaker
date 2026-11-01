/*
 * How big a Help figure draws the interface it pictures (UI-63): at the size the reader's own screen
 * draws it, shrunk to its column by at most `FIGURE_LEAST`. Content that would need more crops to the
 * part being explained instead, so nothing in a figure stands smaller than it does in the app by more
 * than that share, and nothing stands outside the figure's box.
 */
import { createContext, useContext } from 'react';
import { uiScaleOf } from '../../design/scale-model';
import { useScaleView, useSurfaceZoom } from '../../design/scale';
import { ZOOM } from '../../shell/units';

/** The least share of its live size a figure may draw the interface at. */
export const FIGURE_LEAST = 0.75;

/** The share a figure `natural` px wide draws at in `room` px: whole where it fits, shrunk to the
 *  room down to `FIGURE_LEAST`, never past it; `crop` says the content must then be cut to the room. */
export function figureShare(room: number, natural: number): { share: number; crop: boolean } {
  if (room <= 0 || natural <= room) return { share: 1, crop: false };
  const fit = room / natural;
  return fit >= FIGURE_LEAST ? { share: fit, crop: false } : { share: FIGURE_LEAST, crop: true };
}

/** The share a figure that cuts its content to the room draws at: `figureShare`'s where the content
 *  fits by it, and the live size where it must crop, since shrinking a cut only loses legibility. */
export function cutShare(room: number, natural: number): number {
  const { share, crop } = figureShare(room, natural);
  return crop ? 1 : share;
}

/** The width a figure has inside its column, in the figure's own px; 0 before it is measured. */
export const FigureRoomContext = createContext(0);

export function useFigureRoom(): number {
  return useContext(FigureRoomContext);
}

/** The height of the Help window's reading area, in the figure's own px; 0 before it is measured. */
export const FigureSightContext = createContext(0);

export function useFigureSight(): number {
  return useContext(FigureSightContext);
}

/** The share of the reading area's height a miniature of a whole window may take, so it stands in
 *  view whole with the names above it and its caption. */
export const MINIATURE_SIGHT = 0.55;

/** The zoom, inside the figure, at which the frame's own controls (bars, shelves, the rail) draw the
 *  size the reader's screen draws them: the frame's zoom over the zoom the Help window stands under.
 *  Inside a posed form (`HelpFigure.form`) the frame's scale is that form's. */
export function useLiveFrameZoom(): number {
  const frame = ZOOM * uiScaleOf(useScaleView());
  return frame / useSurfaceZoom();
}

/** A box of map cells by their edges: `x2` and `y2` are the far edges, not the last cells. */
export interface CellBox { x1: number; y1: number; x2: number; y2: number }

/** The cells a demo's frame keeps around its subject on every side, room for a label or a chip. */
const DEMO_PAD = 1.5;

/** How far past its scene's own cell size a demo's camera closes in on a subject that leaves room,
 *  so a small subject reads at the size a reader working on it zooms the editor to. */
const DEMO_LIFT = 1.6;

/** A demo's camera over a `W` x `H` px map: centred on `subject` (the cells the scene acts on and
 *  shows), at the largest cell that keeps it and `DEMO_PAD` whole, no larger than `DEMO_LIFT` times
 *  the scene's own `tile` and no smaller than `floor`. The centre is in cells, by edges. */
export function demoFrame(subject: CellBox, tile: number, W: number, H: number, floor: number): { tile: number; cx: number; cy: number } {
  const fit = Math.min(W / (subject.x2 - subject.x1 + 2 * DEMO_PAD), H / (subject.y2 - subject.y1 + 2 * DEMO_PAD));
  return {
    tile: Math.max(floor, Math.min(fit, tile * DEMO_LIFT)),
    cx: (subject.x1 + subject.x2) / 2,
    cy: (subject.y1 + subject.y2) / 2,
  };
}
