/**
 * Every in-app picture of a map (cards, planet windows, the repair choice, the assistant, Help): a
 * map that need not be the live one, drawn by the renderer that draws the live one.
 *
 * There is one drawing of a map, so a card cannot promise a planet the click does not build:
 * `MapRenderer.captureState` builds the real base, terrain, object and notes layers over the
 * picture's own grid, off the stage, and rasterizes them with the live renderer's GPU context. The
 * colours, the trims, the road shapes, the waterfall arrows, the icons and the plan notes are the
 * map's own by construction, and whole-island framing excludes the sea added for the reference grid.
 *
 * What is left here is the framing. A run bounded by a painted region only writes inside it, so a
 * card framed on the whole planet photographs a change a few cells across at a few pixels:
 * `focusFrame` frames those cells instead, at the card's own shape, and falls back to the planet
 * where the region is most of the map anyway.
 *
 * And the sea: a template is rarely the card's shape, so a map drawn to fit one leaves bars down two
 * of its sides. The margin is filled with the value the map's own void cells carry, which is also
 * the 2D canvas's background, so there is no seam and no letterbox — a card shows what the editor
 * shows when it fits the map to the window.
 */
import { WATER_COLOR } from '../../../core/model/palette';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { objectRect } from '../../../state/object-geometry';
import { cellsCaptureFrame, type MapFrame } from '../../../core/grid/map-chunks';
import type { AnnotationsState } from '../../../core/model/annotations';
import { boundedMap, type BoundedMap } from '../../../core/base/bounded-map';
import { useEditorStore } from '../../../state/store';
import { pictureNotes } from '../../shared/annotation/draw-options';
import { getMapRenderer } from '../scene/renderer-registry';

/** A rectangle of macro cells a picture is framed on, where the whole template is not the answer. */
export interface CellFrame { x: number; y: number; width: number; height: number }

/**
 * Air kept around a focused region, as a share of its longer side and never fewer than a couple of
 * cells: a region photographed edge to edge says nothing about where on the planet it sits.
 */
const FOCUS_PAD = 0.15;
const FOCUS_PAD_MIN = 2;
/**
 * A frame that reaches this much of the template is the planet's own frame. Zooming a hair into a
 * region that covers most of the map buys nothing and costs the picture its horizon, so the whole
 * map is the honest answer there.
 */
const FOCUS_MAX_SHARE = 0.55;

/**
 * The cells a card should be a picture of, when a painted region is what the run applies to — or
 * null for the whole map.
 *
 * The card's own shape, grown on the short axis. A crop narrower than the picture would cut the
 * region's own cells out of the promise the card is making, so the frame only ever grows: to the
 * card's aspect, then back inside the template, where the sea framing below finishes the job.
 */
export function focusFrame(
  box: { origin: { x: number; y: number }; width: number; height: number } | null,
  template: { width: number; height: number } | null,
  aspect: number,
): CellFrame | null {
  if (!box || !template || box.width <= 0 || box.height <= 0) return null;
  const pad = Math.max(FOCUS_PAD_MIN, Math.round(FOCUS_PAD * Math.max(box.width, box.height)));
  let width = box.width + 2 * pad;
  let height = box.height + 2 * pad;
  if (width / height < aspect) width = Math.round(height * aspect);
  else height = Math.round(width / aspect);
  width = Math.min(width, template.width);
  height = Math.min(height, template.height);
  if (width * height >= FOCUS_MAX_SHARE * template.width * template.height) return null;
  const centre = (mid: number, size: number, span: number): number =>
    Math.min(span - size, Math.max(0, Math.round(mid - size / 2)));
  return {
    x: centre(box.origin.x + box.width / 2, width, template.width),
    y: centre(box.origin.y + box.height / 2, height, template.height),
    width,
    height,
  };
}

/** Where a picture of `w`x`h` sits inside the smallest box of the given aspect that holds it.
 *  `aspect` is width over height; the picture keeps its size and only the short axis grows. */
export function seaFrame(
  w: number,
  h: number,
  aspect: number,
): { width: number; height: number; dx: number; dy: number } {
  const width = Math.max(w, Math.round(h * aspect));
  const height = Math.max(h, Math.round(w / aspect));
  return { width, height, dx: Math.floor((width - w) / 2), dy: Math.floor((height - h) / 2) };
}

function frameInSea(shot: HTMLCanvasElement, aspect: number): HTMLCanvasElement {
  const box = seaFrame(shot.width, shot.height, aspect);
  if (box.width === shot.width && box.height === shot.height) return shot;
  const out = document.createElement('canvas');
  out.width = box.width;
  out.height = box.height;
  const ctx = out.getContext('2d');
  if (!ctx) return shot;
  ctx.fillStyle = WATER_COLOR;
  ctx.fillRect(0, 0, box.width, box.height);
  ctx.drawImage(shot, box.dx, box.dy);
  return out;
}

/**
 * The cells a picture of `state` covers, in cells, and so where a painter places it: `frame` when the
 * picture is a crop; else everything the renderer draws of the map, the whole template with the
 * terrain bleed of its first row and column and every object it draws, `flagged` included. An
 * object's art stays inside its footprint (`draw/sprite-fit.ts:footprintFit`), so its footprint
 * bounds its drawing; a landmark laid past the template's edge (Hexia's station) widens the picture.
 */
export function mapPictureFrame(state: Pick<GridState, 'template' | 'objects'>, frame?: CellFrame, flagged: readonly PlacedObject[] = []): MapFrame {
  if (frame) return cellsCaptureFrame(frame);
  const box = cellsCaptureFrame({ x: 0, y: 0, width: state.template.width, height: state.template.height });
  let x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  for (const objects of [state.objects.values(), flagged]) {
    for (const o of objects) {
      const r = objectRect(o);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** What a picture of a map is, beyond its grid and its long side. */
export interface MapPictureOptions {
  /** Width over height of the picture, the map centred in sea; absent keeps the map's own shape. */
  aspect?: number;
  /** The cells to frame; absent frames the whole template. */
  frame?: CellFrame | null;
  /** The caller's version of a grid edited in place, which takes a fresh picture per value; absent
   *  takes it once. The notes are versioned here, so callers never fold them in. */
  version?: string | number;
  /** The notes drawn over the map. Absent draws the map's own as its notes layer shows them; another
   *  map's notes stand where a picture promises the map they land under (a candidate keeps the open
   *  map's notes); null draws none. */
  notes?: AnnotationsState | null;
  /** Objects drawn flagged over the map, as the live overlay flags them. */
  flagged?: readonly PlacedObject[];
}

/** One photograph per grid and key, kept as long as the grid: a cached candidate returns the same
 *  `GridState`, so its picture is taken once. Only successful shots are kept (null means no
 *  renderer yet). Bounded per grid, since `version` makes the key space unbounded; a hit moves its
 *  key to the end of the insertion-ordered `Map`, so eviction is LRU. */
class ShotCache<T> {
  private readonly shots = new WeakMap<GridState, BoundedMap<string, T>>();
  private readonly pending = new WeakMap<GridState, Map<string, Promise<T | null>>>();
  constructor(private readonly perGrid: number) {}

  async take(state: GridState, key: string, shoot: () => Promise<T | null>): Promise<T | null> {
    // A read counts as a use too, or a shot taken once and asked for on every render (a card whose
    // subject never moves) would still age out from under an otherwise-idle cache.
    const seen = this.shots.get(state)?.touch(key);
    if (seen !== undefined) return seen;
    const pending = this.pending.get(state) ?? new Map<string, Promise<T | null>>();
    const running = pending.get(key);
    if (running) return running;
    const take = queued(shoot);
    pending.set(key, take);
    this.pending.set(state, pending);
    try {
      const shot = await take;
      if (shot) {
        const per = this.shots.get(state) ?? boundedMap<string, T>(this.perGrid);
        per.delete(key);
        per.set(key, shot);
        this.shots.set(state, per);
      }
      return shot;
    } finally {
      pending.delete(key);
      if (pending.size === 0) this.pending.delete(state);
    }
  }
}

/** Captures run one at a time: two interleaved `captureState` calls would share the renderer's one
 *  off-stage scene. The chain never rejects, so one failed capture cannot jam the queue. */
let capturing: Promise<unknown> = Promise.resolve();

function queued<T>(shoot: () => Promise<T | null>): Promise<T | null> {
  const take = capturing.then(shoot);
  capturing = take.catch(() => null);
  return take;
}

/** PNGs are small, so more versions of a grid stay as PNGs than as full-size canvases. */
const pngShots = new ShotCache<string>(12);
const canvasShots = new ShotCache<HTMLCanvasElement>(3);

/** The notes' part of a picture's key. Notes change in place under the store's epoch and their tag
 *  labels follow the locale, so both name the drawing; a picture that draws no notes keys none. */
function notesKey(state: GridState, notes: AnnotationsState | null | undefined): string {
  if (!pictureNotes(state, notes)) return '';
  const { annotationsEpoch, locale } = useEditorStore.getState();
  return `${notes === undefined ? 'own' : 'given'}:${annotationsEpoch}:${locale}`;
}

function pictureKey(state: GridState, longSidePx: number, opts: MapPictureOptions): string {
  const { aspect, frame, version, flagged } = opts;
  const framed = frame ? `${frame.x},${frame.y},${frame.width},${frame.height}` : '';
  const flags = flagged?.map((o) => `${o.id}@${o.position.x},${o.position.y},${o.rotation}`).join(';') ?? '';
  return `${longSidePx}|${aspect ?? ''}|${framed}|${version ?? ''}|${notesKey(state, opts.notes)}|${flags}`;
}

async function capture(state: GridState, longSidePx: number, opts: MapPictureOptions): Promise<HTMLCanvasElement | null> {
  const renderer = getMapRenderer();
  if (!renderer) return null;
  const shot = await renderer.captureState(state, {
    maxPx: longSidePx,
    ...(opts.frame ? { frame: opts.frame } : {}),
    ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    ...(opts.flagged?.length ? { flagged: opts.flagged } : {}),
  });
  return shot && opts.aspect ? frameInSea(shot, opts.aspect) : shot;
}

/**
 * `state` as a PNG data URL whose long side is at most `longSidePx`, drawn by the renderer that
 * draws the live map, plan notes included as `opts.notes` says.
 *
 * Null where there is no 2D renderer to draw with, which the caller shows as a picture still being
 * made rather than as a broken one.
 */
export function renderThumbnail(state: GridState, longSidePx: number, opts: MapPictureOptions = {}): Promise<string | null> {
  return pngShots.take(state, pictureKey(state, longSidePx, opts), async () => (await capture(state, longSidePx, opts))?.toDataURL('image/png') ?? null);
}

/** The same picture as `renderThumbnail`, as a canvas for a painter that draws it again at every
 *  zoom and pan. The canvas is shared: draw from it, never into it. */
export function mapPicture(state: GridState, longSidePx: number, opts: MapPictureOptions = {}): Promise<HTMLCanvasElement | null> {
  return canvasShots.take(state, pictureKey(state, longSidePx, opts), () => capture(state, longSidePx, opts));
}
