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
import { onMapRenderer } from '../scene/renderer-registry';
import { boundsWhere, rectsBounds, type Rect } from '../../../core/grid/rect';
import { cssBoxOf, fitCells, makeCanvas, sizeToCssBox } from '../../shared/viewport/dom-canvas';

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

const extentOf = (r: Rect): CellExtent => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
const rectOf = (e: CellExtent): Rect => ({ x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0 });
const isRect = (r: Rect | null): r is Rect => r !== null;

/** The cells `o` stands on. */
function footprint(o: PlacedObject): Rect {
  const { w, h } = getPlacedObjectSize(o);
  return { x: o.position.x, y: o.position.y, w, h };
}

/** What the picture shows of the planet: every cell off the sea (grass, sand, rim, plaza), every
 *  raised or water terrain cell where it is drawn (at the terrain grid's offset) and every object
 *  footprint. `null` for a planet with nothing on it. */
function landBounds(state: GridState): CellExtent | null {
  const { width, height } = state.template;
  const cell = (x: number, y: number) => state.cells[y]?.[x];
  const land = boundsWhere(width, height, (x, y) => { const c = cell(x, y); return !!c && !isOpenSeaZone(c.zone); });
  const raised = boundsWhere(width, height, (x, y) => {
    const t = cell(x, y)?.terrain;
    return !!t && (t.type === TerrainType.Water || (t.type === TerrainType.Mountain && t.elevation >= 1));
  });
  const { x: ox, y: oy } = TERRAIN_GRID_OFFSET;
  const all = rectsBounds([
    land, raised && { ...raised, x: raised.x + ox, y: raised.y + oy }, rectsBounds(Array.from(state.objects.values(), footprint)),
  ].filter(isRect));
  return all && extentOf(all);
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
  const box = rectsBounds(rects);
  const made = box ? makeCanvas(box.w * MARK_RASTER, box.h * MARK_RASTER) : null;
  if (!box || !made) { droppedRasters.set(dropped, null); return null; }
  made.ctx.fillStyle = LOSS_COLOR;
  const px = (v: number): number => Math.round(v * MARK_RASTER);
  for (const r of rects) made.ctx.fillRect(px(r.x - box.x), px(r.y - box.y), px(r.w), px(r.h));
  const raster = { canvas: made.canvas, ...box };
  droppedRasters.set(dropped, raster);
  return raster;
}

/** The box the rest view fits: the land of `input`'s map plus any dropped cells and flagged
 *  objects, or the whole template when nothing is on it. Two pictures given one input's box share
 *  scale and centre. */
export function planetBounds(input: PlanetPaintInput): CellExtent {
  const { template } = input;
  const land = landOf(input);
  const lost = input.dropped?.length ? droppedRaster(input.dropped) : null;
  const shown = rectsBounds([land && rectOf(land), lost, ...(input.flagged ?? []).map(footprint)].filter(isRect));
  return shown ? extentOf(shown) : { x0: 0, y0: 0, x1: template.width, y1: template.height };
}

interface PaintOpts { margin: number; bounds?: CellExtent }

/** The long side, in px, of the picture that is sharp in `canvas` at `view`: the device pixels a
 *  cell takes there across the picture's frame, rounded up to the next step. */
export function planetPictureSide(canvas: HTMLCanvasElement, input: PlanetPaintInput, view: PlanetView, opts: PaintOpts): number {
  const { cssW, cssH, scale: dpr } = cssBoxOf(canvas);
  const frame = pictureFrameOf(input);
  const fit = fitCells(cssW, cssH, rectOf(opts.bounds ?? planetBounds(input)), opts.margin);
  const want = fit.cell * view.scale * dpr * Math.max(frame.width, frame.height);
  return PICTURE_STEPS.find((step) => step >= want) ?? PICTURE_STEPS[PICTURE_STEPS.length - 1]!;
}

/** The frame `input`'s picture is taken over (`thumbnail.ts:mapPictureFrame`). */
function pictureFrameOf(input: PlanetPaintInput) {
  return mapPictureFrame(shownMap(input).state, undefined, input.flagged);
}

/** Resolves as the next map renderer is installed, or as `signal` aborts. */
function rendererInstalled(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { off(); signal.removeEventListener('abort', done); resolve(); };
    const off = onMapRenderer(done);
    signal.addEventListener('abort', done);
  });
}

/** The picture of `input`'s map at `longSidePx`, drawn by the map's renderer with its plan notes as
 *  its notes layer shows them and `input.flagged` flagged. Where no renderer stands yet it is taken
 *  once one does; null once `signal` aborts. */
export async function planetPicture(input: PlanetPaintInput, longSidePx: number, signal: AbortSignal): Promise<HTMLCanvasElement | null> {
  const { state, revision } = shownMap(input);
  while (!signal.aborted) {
    const picture = await mapPicture(state, longSidePx, {
      ...(revision !== undefined ? { version: revision } : {}),
      ...(input.flagged?.length ? { flagged: input.flagged } : {}),
    });
    if (picture) return signal.aborted ? null : picture;
    if (signal.aborted) break;
    await rendererInstalled(signal);
  }
  return null;
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
  const sized = sizeToCssBox(canvas);
  if (!sized) return;
  const { ctx, cssW, cssH, scale: dpr } = sized;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const { template } = input;
  if (template.width <= 0 || template.height <= 0) return;

  const lost = input.dropped?.length ? droppedRaster(input.dropped) : null;
  const fit = fitCells(cssW, cssH, rectOf(opts.bounds ?? planetBounds(input)), opts.margin);
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
