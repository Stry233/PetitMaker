/**
 * A planet as a flat top-down picture fitted to the land's bounding box, with chunk dashes across the
 * whole template and optionally the cells a planet change would drop. The map is rasterised once per
 * input (and when the revision its caller hands over moves) at two pixels per cell, so half-cell offsets
 * land on whole pixels; later paints only scale that raster.
 */
import { LOSS_COLOR } from '../../shared/viewport/view-constants';
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../core/model/palette';
import { hasLandmark, isLandmarkItem, landmarkObjects } from '../../../core/model/landmarks';
import { numberToHexString } from '../../../core/base/color';
import { isCoating } from '../../../core/model/traits';
import { TerrainType, type GridState, type MacroCoord, type MapTemplate, type PlacedObject, type TerrainCell } from '../../../core/model/types';
import { isOpenSeaZone } from '../../../core/game/zones';
import { iconUrl } from '../../../assets/icon-urls';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { createGridState } from '../../../core/model/template';
import { objectMarkColor } from '../../shared/terrain/layer-section';
import { CHUNK_GRID_STYLE, chunkGridRects, chunkStrokeCells } from '../../shared/grid/reference-grid';
import { ELEVATION_MAX } from '../../../core/game/profile';

interface PlanetView {
  /** Pan in css px, applied after the zoom. */
  tx: number;
  ty: number;
  /** Zoom about the canvas centre; 1 fits the planet. */
  scale: number;
}

interface PlanetPaintInput {
  /** The map to draw; absent draws the template as a fresh map would open on it. */
  state?: GridState;
  /** `state`'s edit revision, which keys its raster; absent rasterises it again. */
  revision?: string;
  template: MapTemplate;
  /** Cells drawn in the loss red, in the template's coordinates; may lie outside it. */
  dropped?: readonly MacroCoord[];
}

/** Raster pixels per cell: two, so half-cell positions are whole pixels. */
const PX = 2;
const DROPPED_ALPHA = 0.8;
const CHUNK_INK = numberToHexString(CHUNK_GRID_STYLE.planetPreview.ink);

/** A box in cell units: `x0, y0` inclusive, `x1, y1` exclusive. */
export interface CellExtent { x0: number; y0: number; x1: number; y1: number }

interface Raster { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }
interface MapRaster { revision: string | undefined; raster: Raster | null; land: CellExtent | null }

const mapRasters = new WeakMap<GridState, MapRaster>();
const droppedRasters = new WeakMap<readonly MacroCoord[], Raster | null>();

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

function terrainColor(t: TerrainCell): string | null {
  if (t.type === TerrainType.Water) return WATER_COLOR;
  if (t.type === TerrainType.Mountain && t.elevation >= 1) {
    return ELEVATION_COLORS[Math.min(t.elevation, ELEVATION_MAX)] ?? ELEVATION_COLORS[1]!;
  }
  return null;
}

/** Fills one raster row as runs of equal colour, so a coastline costs a call per run, not per cell. */
function fillRuns(ctx: CanvasRenderingContext2D, y: number, width: number, colorAt: (x: number) => string | null, dx = 0): void {
  let start = 0, run: string | null = null;
  for (let x = 0; x <= width; x++) {
    const c = x < width ? colorAt(x) : null;
    if (c === run) continue;
    if (run) { ctx.fillStyle = run; ctx.fillRect((start * PX) + dx, y * PX + dx, (x - start) * PX, PX); }
    start = x; run = c;
  }
}

/** Zones, then terrain half a cell up-left, then coatings under solids. One pixel of margin on the
 *  top and left holds the half cell terrain on row and column zero reaches past the map. */
function mapRaster(state: GridState, revision: string | undefined): MapRaster {
  const hit = mapRasters.get(state);
  if (hit && revision !== undefined && hit.revision === revision) return hit;
  const { width, height } = state.template;
  const land = landBounds(state);
  const made = makeCanvas(width * PX + 1, height * PX + 1);
  if (!made) { const entry = { revision, raster: null, land }; mapRasters.set(state, entry); return entry; }
  const { canvas, ctx } = made;

  for (let y = 0; y < height; y++) {
    const row = state.cells[y];
    fillRuns(ctx, y, width, (x) => ZONE_COLORS[row?.[x]?.zone ?? 0] ?? ZONE_COLORS[0]!, 1);
  }
  for (let y = 0; y < height; y++) {
    const row = state.cells[y];
    fillRuns(ctx, y, width, (x) => { const t = row?.[x]?.terrain; return t ? terrainColor(t) : null; });
  }
  const coatings: PlacedObject[] = [], solids: PlacedObject[] = [];
  for (const o of state.objects.values()) {
    if (isLandmarkItem(o.catalogId)) continue;
    const item = getCatalogItem(o.catalogId);
    (item && isCoating(item) ? coatings : solids).push(o);
  }
  for (const o of [...coatings, ...solids]) {
    const { w, h } = getPlacedObjectSize(o);
    ctx.fillStyle = objectMarkColor(o.catalogId);
    ctx.fillRect(o.position.x * PX + 1, o.position.y * PX + 1, w * PX, h * PX);
  }

  const raster = { canvas, x: -1 / PX, y: -1 / PX, w: width + 1 / PX, h: height + 1 / PX };
  const entry = { revision, raster, land };
  mapRasters.set(state, entry);
  return entry;
}

function grow(b: CellExtent | null, x0: number, y0: number, x1: number, y1: number): CellExtent {
  if (!b) return { x0, y0, x1, y1 };
  return { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) };
}

/** What the picture shows of the planet: every cell off the sea (grass, sand, rim, plaza), every
 *  terrain cell where it is drawn (half a cell up-left) and every object footprint. `null` for a
 *  planet with nothing on it. */
function landBounds(state: GridState): CellExtent | null {
  let b: CellExtent | null = null;
  const half = 1 / PX;
  for (let y = 0; y < state.cells.length; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!c) continue;
      if (!isOpenSeaZone(c.zone)) b = grow(b, x, y, x + 1, y + 1);
      if (c.terrain && terrainColor(c.terrain)) b = grow(b, x - half, y - half, x + 1 - half, y + 1 - half);
    }
  }
  for (const o of state.objects.values()) {
    const { w, h } = getPlacedObjectSize(o);
    b = grow(b, o.position.x, o.position.y, o.position.x + w, o.position.y + h);
  }
  return b;
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

const freshMaps = new WeakMap<MapTemplate, GridState>();
/** The revision a fresh map's raster is kept under. */
const FRESH = 'fresh';

/** The map a template opens as, its own terrain and plaza included. */
function freshMap(template: MapTemplate): GridState {
  let state = freshMaps.get(template);
  if (!state) { state = createGridState(template); freshMaps.set(template, state); }
  return state;
}

function droppedRaster(dropped: readonly MacroCoord[]): Raster | null {
  const hit = droppedRasters.get(dropped);
  if (hit !== undefined) return hit;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of dropped) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  const made = dropped.length ? makeCanvas(x1 - x0 + 1, y1 - y0 + 1) : null;
  if (!made) { droppedRasters.set(dropped, null); return null; }
  made.ctx.fillStyle = LOSS_COLOR;
  for (const c of dropped) made.ctx.fillRect(c.x - x0, c.y - y0, 1, 1);
  const raster = { canvas: made.canvas, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  droppedRasters.set(dropped, raster);
  return raster;
}

// Each landmark icon loads once; a paint that ran before one arrived runs again when it does. A failed
// load leaves that landmark drawn by its zone colour alone and nothing waiting.
const landmarkIcons = new Map<string, HTMLImageElement | 'failed'>();
const awaitingIcon = new Map<HTMLCanvasElement, () => void>();

function loadedLandmarkIcon(name: string): HTMLImageElement | null {
  let icon = landmarkIcons.get(name);
  if (icon === 'failed') return null;
  if (!icon) {
    const url = iconUrl(name);
    if (!url || typeof Image === 'undefined') return null;
    const img = new Image();
    img.onload = () => {
      const repaints = [...awaitingIcon.values()];
      awaitingIcon.clear();
      for (const repaint of repaints) repaint();
    };
    img.onerror = () => {
      landmarkIcons.set(name, 'failed');
      awaitingIcon.clear();
    };
    img.src = url;
    landmarkIcons.set(name, img);
    icon = img;
  }
  return icon.complete && icon.naturalWidth > 0 ? icon : null;
}

/** Each landmark's laid footprint and icon basename, in profile order. */
function landmarksOf(state: GridState): { x: number; y: number; w: number; h: number; icon: string | undefined }[] {
  return landmarkObjects(state).filter((o) => hasLandmark(o)).map((o) => ({
    x: o.position.x, y: o.position.y, w: o.width!, h: o.height!, icon: o.icon ?? getCatalogItem(o.catalogId)?.icon,
  }));
}

/** Draws the icon upright, contained and centred in the laid footprint, as the 2D view does: a
 *  footprint-turning object's art rests upright in every footprint. */
function drawLandmark(ctx: CanvasRenderingContext2D, icon: HTMLImageElement, p: { x: number; y: number; w: number; h: number }): void {
  const fit = Math.min(p.w / icon.naturalWidth, p.h / icon.naturalHeight);
  const iw = icon.naturalWidth * fit, ih = icon.naturalHeight * fit;
  ctx.drawImage(icon, p.x + (p.w - iw) / 2, p.y + (p.h - ih) / 2, iw, ih);
}

/** The raster of `input`'s map; a fresh map is never edited, so its one raster always stands. */
function shownRaster(input: PlanetPaintInput): MapRaster {
  return input.state ? mapRaster(input.state, input.revision) : mapRaster(freshMap(input.template), FRESH);
}

/** The box the rest view fits: the land of `input`'s map plus any dropped cells, or the whole
 *  template when nothing is on it. Two pictures given one input's box share scale and centre. */
export function planetBounds(input: PlanetPaintInput): CellExtent {
  const { template } = input;
  let shown = shownRaster(input).land;
  const lost = input.dropped?.length ? droppedRaster(input.dropped) : null;
  if (lost) shown = grow(shown, lost.x, lost.y, lost.x + lost.w, lost.y + lost.h);
  return shown ?? { x0: 0, y0: 0, x1: template.width, y1: template.height };
}

/**
 * Paints the planet into `canvas`, sized to its css box at the device-pixel ratio. At `scale` 1 and
 * no pan the land and any dropped cells fit the box less `margin` css px on every side, centred;
 * `view` then zooms about the canvas centre and pans in css px. `opts.bounds` replaces that box.
 */
export function paintPlanet(
  canvas: HTMLCanvasElement,
  input: PlanetPaintInput,
  view: PlanetView,
  opts: { margin: number; bounds?: CellExtent },
): void {
  const dpr = globalThis.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width / dpr;
  const cssH = canvas.clientHeight || canvas.height / dpr;
  const backW = Math.max(1, Math.round(cssW * dpr)), backH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== backW) canvas.width = backW;
  if (canvas.height !== backH) canvas.height = backH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, backW, backH);
  const { template } = input;
  if (template.width <= 0 || template.height <= 0) return;

  const state = input.state ?? freshMap(template);
  const { raster: map } = shownRaster(input);
  const lost = input.dropped?.length ? droppedRaster(input.dropped) : null;
  const fit = fitBounds(cssW, cssH, opts.bounds ?? planetBounds(input), opts.margin);
  const cx = cssW / 2, cy = cssH / 2;
  const cell = fit.cell * view.scale;
  const ox = cx + (fit.x - cx) * view.scale + view.tx;
  const oy = cy + (fit.y - cy) * view.scale + view.ty;
  // Cell units from here on.
  ctx.setTransform(dpr * cell, 0, 0, dpr * cell, dpr * ox, dpr * oy);
  ctx.imageSmoothingEnabled = false;

  if (map) ctx.drawImage(map.canvas, map.x, map.y, map.w, map.h);

  for (const landmark of landmarksOf(state)) {
    if (!landmark.icon) continue;
    const icon = loadedLandmarkIcon(landmark.icon);
    if (icon) drawLandmark(ctx, icon, landmark);
    else if (landmarkIcons.has(landmark.icon) && landmarkIcons.get(landmark.icon) !== 'failed') awaitingIcon.set(canvas, () => paintPlanet(canvas, input, view, opts));
  }

  ctx.fillStyle = CHUNK_INK;
  ctx.globalAlpha = CHUNK_GRID_STYLE.planetPreview.opacity;
  for (const r of chunkGridRects(template, chunkStrokeCells(cell, CHUNK_GRID_STYLE.planetPreview.widthPx))) ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.globalAlpha = 1;

  if (lost) {
    ctx.globalAlpha = DROPPED_ALPHA;
    ctx.drawImage(lost.canvas, lost.x, lost.y, lost.w, lost.h);
    ctx.globalAlpha = 1;
  }
}
