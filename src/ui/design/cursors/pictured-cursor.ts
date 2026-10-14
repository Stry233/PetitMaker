/**
 * A cursor drawn into a picture as an image (the tour's gesture diagrams, the Help figures' pointer):
 * the app's own art at one drawn size, hung from its hotspot so the element's origin is the acting
 * pixel.
 */
import { cursorArt } from '../../../assets/cursors/cursor-art';
import { CURSORS, CURSOR_SIZE, type CursorId } from '../../../assets/cursors/cursor-spec';

/** The drawn tile in CSS px; the painted arrow inside it reads at about 20. */
export const PICTURED_CURSOR_PX = 24;

/** Cursor `id`'s art at `PICTURED_CURSOR_PX`, with the offset that puts its hotspot on the origin;
 *  null for an id with no drawing. */
export function picturedCursor(id: CursorId): { url: string; left: number; top: number } | null {
  const url = cursorArt(id);
  if (!url) return null;
  const { hotspot, size = CURSOR_SIZE } = CURSORS[id];
  const scale = PICTURED_CURSOR_PX / size;
  return { url, left: -hotspot[0] * scale, top: -hotspot[1] * scale };
}
