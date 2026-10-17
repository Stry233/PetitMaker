/**
 * A planet as a top-down picture fitted to the land's bounding box, with chunk dashes across the
 * whole template and optionally cells marked in the loss red. The map itself is
 * `thumbnail.ts`'s picture, the renderer's own drawing of it with its plan notes and any flagged
 * objects; this painter only places it, over the frame the capture took, so a pan or a zoom repaints
 * from the one picture and never draws the map again.
 */
import { LOSS_COLOR } from '../../shared/viewport/view-constants';
import { numberToHexString } from '../../../core/base/color';
import { TerrainType, type GridState, type MapTemplate, type PlacedObject } from '../../../core/model/types';
import { gridCellRect, type GridCellRef } from '../../../core/grid/grids';
import { GRIDS } from '../../../core/game/profile';
import { isOpenSeaZone } from '../../../core/game/zones';
import { TERRAIN_GRID_OFFSET } from '../../../core/grid/grid-convert';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { createGridState } from '../../../core/model/template';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../../shared/grid/reference-grid';
import { mapPicture, mapPictureFrame } from './thumbnail';

interface PlanetView {
  /** Pan in css px, applied after the zoom. */
  tx: number;
  ty: number;
  /** Zoom about the canvas centre; 1 fits the planet. */
  scale: number;
}

export interface PlanetPaintInput {
  /** The map to draw; absent draws the template as a fresh map would open on it. */
  state?: GridState;
  /** `state`'s edit revision, which keys its picture and land; absent takes them again. */
  revision?: string;
  template: MapTemplate;
  /** Cells drawn in the loss red, each where its own grid lays it (a terrain cell half a cell up and
   *  left of a placement cell of the same index), in the template's coordinates; may lie outside it. */
  dropped?: readonly GridCellRef[];
  /** Objects the picture draws flagged, as the live overlay flags them; they need not stand on `state`. */
  flagged?: readonly PlacedObject[];
}

const DROPPED_ALPHA = 0.8;
const CHUNK_INK = numberToHexString(CHUNK_GRID_STYLE.planetPreview.ink);
/** The picture's long side comes in these steps, so a zoom asks for a sharper one only now and then. */
const PICTURE_STEPS = [256, 512, 1024, 2048, 4096] as const;

/** A box in cell units: `x0, y0` inclusive, `x1, y1` exclusive. */
export interface CellExtent { x0: number; y0: number; x1: number; y1: number }

interface Raster { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }

const lands = new WeakMap<GridState, { revision: string | undefined; land: CellExtent | null }>();
const droppedRasters = new WeakMap<readonly GridCellRef[], Raster | null>();
/** Raster pixels per cell for the dropped marks: every grid's cells start and end on half cells. */
const MARK_RASTER = 2;
const freshMaps = new WeakMap<MapTemplate, GridState>();
/** The revision a fresh map is kept under: it is never edited. */
const FRESH = 'fresh';

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

function grow(b: CellExtent | null, x0: number, y0: number, x1: number, y1: number): CellExtent {
  if (!b) return { x0, y0, x1, y1 };
  return { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) };
}

/** What the picture shows of the planet: every cell off the sea (grass, sand, rim, plaza), every
 *  raised or water terrain cell where it is drawn (at the terrain grid's offset) and every object
 *  footprint. `null` for a planet with nothing on it. */
function landBounds(state: GridState): CellExtent | null {
  let b: CellExtent | null = null;
  const { x: ox, y: oy } = TERRAIN_GRID_OFFSET;
  for (let y = 0; y < state.cells.length; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!c) continue;
      if (!isOpenSeaZone(c.zone)) b = grow(b, x, y, x + 1, y + 1);
      const t = c.terrain;
      if (t && (t.type === TerrainType.Water || (t.type === TerrainType.Mountain && t.elevation >= 1))) {
        b = grow(b, x + ox, y + oy, x + 1 + ox, y + 1 + oy);
      }
    }
  }
  for (const o of state.objects.values()) {
    const { w, h } = getPlacedObjectSize(o);
    b = grow(b, o.position.x, o.position.y, o.position.x + w, o.position.y + h);
  }
  return b;
}

/** The map a template opens as, its own terrain and plaza included. */
function freshMap(template: MapTemplate): GridState {
  let state = freshMaps.get(template);
  if (!state) { state = createGridState(template); freshMaps.set(template, state); }
  return state;
}

/** The map `input` pictures and the revision it is kept under. */
function shownMap(input: PlanetPaintInput): { state: GridState; revision: string | undefined } {
  return input.state ? { state: input.state, revision: input.revision } : { state: freshMap(input.template), revision: FRESH };
}

function landOf(input: PlanetPaintInput): CellExtent | null {
  const { state, revision } = shownMap(input);
  const hit = lands.get(state);
  if (hit && revision !== undefined && hit.revision === revision) return hit.land;
  const land = landBounds(state);
  lands.set(state, { revision, land });
  return land;
}

function droppedRaster(dropped: readonly GridCellRef[]): Raster | null {
  const hit = droppedRasters.get(dropped);
  if (hit !== undefined) return hit;
  const rects = dropped.map((c) => gridCellRect(GRIDS[c.grid], c));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  const made = rects.length ? makeCanvas(Math.round((x1 - x0) * MARK_RASTER), Math.round((y1 - y0) * MARK_RASTER)) : null;
  if (!made) { droppedRasters.set(dropped, null); return null; }
  made.ctx.fillStyle = LOSS_COLOR;
  const px = (v: number): number => Math.round(v * MARK_RASTER);
  for (const r of rects) made.ctx.fillRect(px(r.x - x0), px(r.y - y0), px(r.w), px(r.h));
  const raster = { canvas: made.canvas, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  droppedRasters.set(dropped, raster);
  return raster;
}

/** The box the rest view fits: the land of `input`'s map plus any dropped cells and flagged
 *  objects, or the whole template when nothing is on it. Two pictures given one input's box share
 *  scale and centre. */
export function planetBounds(input: PlanetPaintInput): CellExtent {
  const { template } = input;
  let shown = landOf(input);
  const lost = input.dropped?.length ? droppedRaster(input.dropped) : null;
  if (lost) shown = grow(shown, lost.x, lost.y, lost.x + lost.w, lost.y + lost.h);
  for (const o of input.flagged ?? []) {
    const { w, h } = getPlacedObjectSize(o);
    shown = grow(shown, o.position.x, o.position.y, o.position.x + w, o.position.y + h);
  }
  return shown ?? { x0: 0, y0: 0, x1: template.width, y1: template.height };
}

/** The rest view's placement: `bounds` scaled to fit the box less `margin` css px on every side and
 *  centred, so the margins on opposite sides are equal and the tighter axis has exactly `margin`.
 *  Returns css px per cell and the css position of cell (0, 0). */
function fitBounds(cssW: number, cssH: number, bounds: CellExtent, margin: number): { cell: number; x: number; y: number } {
  const bw = Math.max(1e-6, bounds.x1 - bounds.x0), bh = Math.max(1e-6, bounds.y1 - bounds.y0);
  const room = (side: number) => Math.max(1, side - 2 * margin);
  const cell = Math.min(room(cssW) / bw, room(cssH) / bh);
  return { cell, x: (cssW - bw * cell) / 2 - bounds.x0 * cell, y: (cssH - bh * cell) / 2 - bounds.y0 * cell };
}

interface PaintOpts { margin: number; bounds?: CellExtent }

/** The css box `canvas` paints into. */
function cssBox(canvas: HTMLCanvasElement): { cssW: number; cssH: number; dpr: number } {
  const dpr = globalThis.devicePixelRatio || 1;
  return { cssW: canvas.clientWidth || canvas.width / dpr, cssH: canvas.clientHeight || canvas.height / dpr, dpr };
}

/** The long side, in px, of the picture that is sharp in `canvas` at `view`: the device pixels a
 *  cell takes there across the picture's frame, rounded up to the next step. */
export function planetPictureSide(canvas: HTMLCanvasElement, input: PlanetPaintInput, view: PlanetView, opts: PaintOpts): number {
  const { cssW, cssH, dpr } = cssBox(canvas);
  const frame = pictureFrameOf(input);
  const fit = fitBounds(cssW, cssH, opts.bounds ?? planetBounds(input), opts.margin);
  const want = fit.cell * view.scale * dpr * Math.max(frame.width, frame.height);
  return PICTURE_STEPS.find((step) => step >= want) ?? PICTURE_STEPS[PICTURE_STEPS.length - 1]!;
}

/** The frame `input`'s picture is taken over (`thumbnail.ts:mapPictureFrame`). */
function pictureFrameOf(input: PlanetPaintInput) {
  return mapPictureFrame(shownMap(input).state, undefined, input.flagged);
}

/** The picture of `input`'s map at `longSidePx`, drawn by the map's renderer with its plan notes as
 *  its notes layer shows them and `input.flagged` flagged; null where no renderer stands yet. */
export function planetPicture(input: PlanetPaintInput, longSidePx: number): Promise<HTMLCanvasElement | null> {
  const { state, revision } = shownMap(input);
  return mapPicture(state, longSidePx, {
    ...(revision !== undefined ? { version: revision } : {}),
    ...(input.flagged?.length ? { flagged: input.flagged } : {}),
  });
}

/**
 * Paints the planet into `canvas`, sized to its css box at the device-pixel ratio, from `picture`
 * (`planetPicture` of the same input; null paints the dashes and marks alone). At `scale` 1 and no
 * pan the land and any dropped cells fit the box less `margin` css px on every side, centred;
 * `view` then zooms about the canvas centre and pans in css px. `opts.bounds` replaces that box.
 */
export function paintPlanet(
  canvas: HTMLCanvasElement,
  input: PlanetPaintInput,
  picture: CanvasImageSource | null,
  view: PlanetView,
  opts: PaintOpts,
): void {
  const { cssW, cssH, dpr } = cssBox(canvas);
  const backW = Math.max(1, Math.round(cssW * dpr)), backH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== backW) canvas.width = backW;
  if (canvas.height !== backH) canvas.height = backH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, backW, backH);
  const { template } = input;
  if (template.width <= 0 || template.height <= 0) return;

  const lost = input.dropped?.length ? droppedRaster(input.dropped) : null;
  const fit = fitBounds(cssW, cssH, opts.bounds ?? planetBounds(input), opts.margin);
  const cx = cssW / 2, cy = cssH / 2;
  const cell = fit.cell * view.scale;
  const ox = cx + (fit.x - cx) * view.scale + view.tx;
  const oy = cy + (fit.y - cy) * view.scale + view.ty;
  // Cell units from here on.
  ctx.setTransform(dpr * cell, 0, 0, dpr * cell, dpr * ox, dpr * oy);

  if (picture) {
    // The frame the picture was taken over: what the map draws, not the reference grid's sea.
    const frame = pictureFrameOf(input);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(picture, frame.x, frame.y, frame.width, frame.height);
  }

  ctx.fillStyle = CHUNK_INK;
  ctx.globalAlpha = CHUNK_GRID_STYLE.planetPreview.opacity;
  for (const r of chunkGridRects(template, chunkStrokeCells(cell, CHUNK_GRID_STYLE.planetPreview.widthPx))) ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.globalAlpha = 1;

  if (lost) {
    // Whole cells of each grid, edge to edge, at any zoom.
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = DROPPED_ALPHA;
    ctx.drawImage(lost.canvas, lost.x, lost.y, lost.w, lost.h);
    ctx.globalAlpha = 1;
  }
}
