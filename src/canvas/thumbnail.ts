/**
 * The picture on a candidate card: a map that is not the live one, drawn by the renderer that draws
 * the live one.
 *
 * A CARD IS A PROMISE AND THE PICTURE IS THE WHOLE PROMISE: a second, independent drawing of a
 * `GridState` drifts from the map exactly as a second implementation of one thing always does, and
 * a visitor comparing a card with the island it built would be comparing two pictures of one map.
 *
 * So there is one drawing of a map. `MapRenderer.captureState` builds the real base, terrain and
 * object layers over the candidate's own grid, off the stage, and rasterizes them with the live
 * renderer's GPU context. So the colours, the trims, the road shapes, the waterfall arrows and the
 * icons are the map's own by construction, and the framing is the template exactly, which is the
 * view the editor opens on.
 *
 * WHAT IS LEFT HERE is the sea. A template is rarely the card's shape, and a map drawn to fit one
 * leaves bars down two of its sides; the honest fix is more sea rather than a border in some other
 * colour. The margin is filled with the value the map's own void cells carry, which is also the 2D
 * canvas's own background, so there is no seam and no letterbox: a card shows what the editor shows
 * when it fits the map to the window.
 */
import { WATER_COLOR } from '../core/model/constants';
import type { GridState } from '../core/model/types';
import { getMapRenderer } from './map2d/renderer-registry';

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

/** One photograph per GRID, remembered for as long as the grid itself is: a cached candidate comes
 *  back with the same `GridState` identity, so its picture need not be taken twice. Only successful
 *  shots are kept — a null is "no renderer yet", which the next call may be able to answer. */
const shots = new WeakMap<GridState, Map<string, string>>();

/** Captures run one at a time: two interleaved `captureState` calls would share the renderer's one
 *  off-stage scene. The chain never rejects, so one failed capture cannot jam the queue. */
let capturing: Promise<unknown> = Promise.resolve();

/**
 * `state` as a PNG data URL whose long side is at most `longSidePx`, in a picture of `aspect`
 * (width over height) if one is asked for.
 *
 * Null where there is no 2D renderer to draw with, which the caller shows as a picture still being
 * made rather than as a broken one.
 */
export async function renderThumbnail(
  state: GridState,
  longSidePx: number,
  aspect?: number,
): Promise<string | null> {
  const key = `${longSidePx}|${aspect ?? ''}`;
  const seen = shots.get(state)?.get(key);
  if (seen) return seen;

  const take = capturing.then(async (): Promise<string | null> => {
    const renderer = getMapRenderer();
    if (!renderer) return null;
    const shot = await renderer.captureState(state, longSidePx);
    if (!shot) return null;
    return (aspect ? frameInSea(shot, aspect) : shot).toDataURL('image/png');
  });
  capturing = take.catch(() => null);
  const png = await take;
  if (png) {
    const per = shots.get(state) ?? new Map<string, string>();
    per.set(key, png);
    shots.set(state, per);
  }
  return png;
}
