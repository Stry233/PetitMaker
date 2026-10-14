/**
 * The picture on a candidate card: a map that is not the live one, drawn by the renderer that draws
 * the live one.
 *
 * There is one drawing of a map, so a card cannot promise a planet the click does not build:
 * `MapRenderer.captureState` builds the real base, terrain and object layers over the candidate's
 * own grid, off the stage, and rasterizes them with the live renderer's GPU context. The colours,
 * the trims, the road shapes, the waterfall arrows and the icons are the map's own by construction,
 * and whole-island framing excludes the sea added for the reference grid.
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
import type { GridState } from '../../../core/model/types';
import { boundedMap, type BoundedMap } from '../../../core/base/bounded-map';
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

/** One photograph per grid, kept as long as the grid: a cached candidate returns the same
 *  `GridState`, so its picture is taken once. Only successful shots are kept (null means no renderer
 *  yet). The live grid mutates in place, so a caller photographing a map being edited passes
 *  `version` for a fresh capture per value. Bounded per grid, since `version` makes the key space
 *  unbounded; a hit moves its key to the end of the insertion-ordered `Map`, so eviction is LRU. */
const SHOTS_PER_GRID = 12;
const shots = new WeakMap<GridState, BoundedMap<string, string>>();
const pendingShots = new WeakMap<GridState, Map<string, Promise<string | null>>>();

function rememberShot(state: GridState, key: string, png: string): void {
  const per = shots.get(state) ?? boundedMap<string, string>(SHOTS_PER_GRID);
  per.delete(key);
  per.set(key, png);
  shots.set(state, per);
}

/** Captures run one at a time: two interleaved `captureState` calls would share the renderer's one
 *  off-stage scene. The chain never rejects, so one failed capture cannot jam the queue. */
let capturing: Promise<unknown> = Promise.resolve();

/**
 * `state` as a PNG data URL whose long side is at most `longSidePx`, in a picture of `aspect`
 * (width over height) if one is asked for, framed on `frame`'s cells if one is given and on the
 * whole template otherwise.
 *
 * Null where there is no 2D renderer to draw with, which the caller shows as a picture still being
 * made rather than as a broken one.
 */
export async function renderThumbnail(
  state: GridState,
  longSidePx: number,
  aspect?: number,
  frame?: CellFrame | null,
  version?: string | number,
): Promise<string | null> {
  const key = `${longSidePx}|${aspect ?? ''}|${frame ? `${frame.x},${frame.y},${frame.width},${frame.height}` : ''}|${version ?? ''}`;
  // A read counts as a use too, or a shot taken once and asked for on every render (a card whose
  // subject never moves) would still age out from under an otherwise-idle cache.
  const seen = shots.get(state)?.touch(key);
  if (seen !== undefined) return seen;

  const pending = pendingShots.get(state) ?? new Map<string, Promise<string | null>>();
  const running = pending.get(key);
  if (running) return running;

  const take = capturing.then(async (): Promise<string | null> => {
    const renderer = getMapRenderer();
    if (!renderer) return null;
    const shot = await renderer.captureState(state, { maxPx: longSidePx, frame: frame ?? undefined });
    if (!shot) return null;
    return (aspect ? frameInSea(shot, aspect) : shot).toDataURL('image/png');
  });
  capturing = take.catch(() => null);
  pending.set(key, take);
  pendingShots.set(state, pending);
  try {
    const png = await take;
    if (png) rememberShot(state, key, png);
    return png;
  } finally {
    pending.delete(key);
    if (pending.size === 0) pendingShots.delete(state);
  }
}
