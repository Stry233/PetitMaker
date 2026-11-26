/*
 * The composed share picture a Help figure crops, painted by the export's own pipeline
 * (`export/preview.ts:paintPreviewLayout`) over a posed map and kept for the session, with the 3D
 * card's stills captured once per map.
 */
import type { GridState } from '../../core/model/types';
import { renderThumbnail } from '../../view/map2d/capture/thumbnail';
import { captureCard3dAngles, loadBrandLockup, paintPreviewLayout, type PaintedPreview } from '../export/preview';

/** What the picture is painted from; the base map, the 3D stills and the brand lockup are made here. */
type PicturePose = Omit<Parameters<typeof paintPreviewLayout>[0], 'baseMap' | 'card3dAngles' | 'brandLockup'>;

/** The 3D card's stills, captured once per map: every figure of one picture shares the one set. */
let stills: { state: GridState; promise: Promise<HTMLImageElement[]> } | null = null;
function cardStills(state: GridState): Promise<HTMLImageElement[]> {
  if (stills?.state !== state) stills = { state, promise: captureCard3dAngles(state).catch(() => []) };
  return stills.promise;
}

/** One finished painting per key, shared by every figure that crops it. */
const painted = new Map<string, PaintedPreview>();

/** The picture kept under `key` this session, or null. */
export function paintedPicture(key: string): PaintedPreview | null {
  return painted.get(key) ?? null;
}

/** Paints `pose` through the export pipeline and keeps the picture under `key`. Resolves null, and
 *  keeps nothing, where the base map cannot be drawn or `wanted` stopped holding on the way. */
export async function paintPicture(key: string, pose: PicturePose, wanted: () => boolean): Promise<PaintedPreview | null> {
  const [shotUrl, angles, lockup] = await Promise.all([
    renderThumbnail(pose.state, 1200), cardStills(pose.state), loadBrandLockup(pose.locale),
  ]);
  if (!wanted() || !shotUrl) return null;
  const baseMap = new Image();
  baseMap.src = shotUrl;
  await baseMap.decode().catch(() => {});
  if (!wanted() || !baseMap.width) return null;
  const next = paintPreviewLayout({ ...pose, baseMap, card3dAngles: angles, brandLockup: lockup });
  if (!wanted() || !next) return null;
  painted.set(key, next);
  return next;
}
