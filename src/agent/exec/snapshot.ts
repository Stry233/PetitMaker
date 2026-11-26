/**
 * The assistant's map pictures: the job's own map drawn by the renderer that draws the live one
 * (`view/map2d/capture/thumbnail.ts`), whatever the views show meanwhile, so a stand-in shown in its
 * place is never photographed. A PNG data URL at most 1024 px on its long side, or null with no 2D
 * renderer to draw with (headless tests) or a failed drawing.
 */
import type { GridState } from '../../core/model/types';
import { mapRevisionOf } from '../../core/model/grid-model';
import { renderThumbnail } from '../../view/map2d/capture/thumbnail';
import { groundPicture, type GroundRect } from '../../view/map2d/capture/ground-levels';
import { PngStream } from '../../io/export/png-stream';
import { bytesToDataUrl } from '../../platform/remote/data-url';

const SNAPSHOT_PX = 1024;

/** The whole of `state` without the camera, selection marks, ghosts or labels, and without the
 *  planning annotations unless `notes`; a picture per edit revision, since the job edits the map in
 *  place. */
export function takeMapSnapshot(state: GridState, notes = false): Promise<string | null> {
  return renderThumbnail(state, SNAPSHOT_PX, { version: `${mapRevisionOf(state)}:${notes ? 'plan' : 'map'}`, ...(notes ? {} : { notes: null }) });
}

/** The look-closer half: `state` framed to one rect of macro cells (inclusive, clamped to the map). */
export function takeMapRegionSnapshot(state: GridState, rect: { x1: number; y1: number; x2: number; y2: number }, notes = false): Promise<string | null> {
  const { width, height } = state.template;
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max - 1, Math.round(v)));
  const [x1, x2] = [clamp(Math.min(rect.x1, rect.x2), width), clamp(Math.max(rect.x1, rect.x2), width)];
  const [y1, y2] = [clamp(Math.min(rect.y1, rect.y2), height), clamp(Math.max(rect.y1, rect.y2), height)];
  const frame = { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
  return renderThumbnail(state, SNAPSHOT_PX, { frame, version: `${mapRevisionOf(state)}:${notes ? 'plan' : 'map'}`, ...(notes ? {} : { notes: null }) });
}

/** The level picture (`view/map2d/capture/ground-levels.ts`) of a rectangle of terrain cells, the
 *  whole map by default, as a PNG data URL about SNAPSHOT_PX on its long side, with the terrain cell
 *  at its top-left corner and the pixels each cell takes. */
export async function takeGroundSnapshot(state: GridState, rect?: GroundRect): Promise<{ url: string; origin: { x: number; y: number }; scale: number }> {
  const { width: mw, height: mh } = state.template;
  const cw = rect ? rect.x2 - rect.x1 + 1 : mw, ch = rect ? rect.y2 - rect.y1 + 1 : mh;
  const pic = groundPicture(state, Math.max(2, Math.floor(SNAPSHOT_PX / Math.max(cw, ch))), rect);
  const png = new PngStream(pic.width, pic.height);
  png.addRows(pic.rgba, pic.height);
  return { url: bytesToDataUrl(new Uint8Array(await png.finish().arrayBuffer()), 'image/png'), origin: pic.origin, scale: pic.scale };
}
