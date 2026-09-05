/*
 * demo-cursor.ts — the Help figures' pointer is the app's own cursor art, as a DOM image.
 *
 * Resolution mirrors the live seam: the classic set when the build ships it (with the classic
 * hotspots — the two sets' hotspots are not interchangeable), the painted set otherwise, at the
 * same drawn size the tour diagrams use. The image hangs off the pointer host at the negative
 * hotspot offset, so the host's own position IS the acting point — the pixel the click lands on.
 */
import { CURSORS, CURSOR_SIZE, type CursorId } from '../../../../../core/runtime/cursor-spec';
import { cursorArt } from '../../../../../assets/cursors/cursor-art';
import { classicCursorArt, CLASSIC_CURSOR_SIZE } from '../../../../../assets/cursors/cursor-art-classic';
import { USE_CLASSIC_CURSORS } from '../../../../../assets/cursors/cursor-set';

export const DEMO_CURSOR_PX = USE_CLASSIC_CURSORS ? 22 : 24;

interface CursorFace {
  url: string;
  hotspot: readonly [number, number];
  size: number;
}

function faceFor(id: CursorId): CursorFace | null {
  if (USE_CLASSIC_CURSORS) {
    const classic = classicCursorArt(id);
    if (classic) return { url: classic.url, hotspot: classic.hotspot, size: CLASSIC_CURSOR_SIZE };
  }
  const url = cursorArt(id);
  if (!url) return null;
  const spec = CURSORS[id];
  return { url, hotspot: spec.hotspot, size: spec.size ?? CURSOR_SIZE };
}

/** Put cursor `id`'s art into `host`, offset so the host's position is the acting point. */
export function drawCursorImg(host: HTMLElement, id: CursorId): void {
  const face = faceFor(id);
  if (!face) { host.replaceChildren(); return; }
  let img = host.firstElementChild as HTMLImageElement | null;
  if (!img || img.tagName !== 'IMG') {
    img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    img.style.position = 'absolute';
    host.replaceChildren(img);
  }
  const s = DEMO_CURSOR_PX / face.size;
  img.src = face.url;
  img.style.width = `${face.size * s}px`;
  img.style.height = `${face.size * s}px`;
  img.style.left = `${-face.hotspot[0] * s}px`;
  img.style.top = `${-face.hotspot[1] * s}px`;
}
