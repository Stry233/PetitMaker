/*
 * The Help figures' pointer is the app's own cursor art, as a DOM image at the drawn size every
 * pictured cursor uses. The image hangs off the pointer host at the negative hotspot offset, so the
 * host's own position is the acting point: the pixel the click lands on.
 */
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { PICTURED_CURSOR_PX, picturedCursor } from '../../design/cursors/pictured-cursor';

/** Put cursor `id`'s art into `host`, offset so the host's position is the acting point. */
export function drawCursorImg(host: HTMLElement, id: CursorId): void {
  const face = picturedCursor(id);
  if (!face) { host.replaceChildren(); return; }
  let img = host.firstElementChild as HTMLImageElement | null;
  if (!img || img.tagName !== 'IMG') {
    img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    img.style.position = 'absolute';
    host.replaceChildren(img);
  }
  img.src = face.url;
  img.style.width = `${PICTURED_CURSOR_PX}px`;
  img.style.height = `${PICTURED_CURSOR_PX}px`;
  img.style.left = `${face.left}px`;
  img.style.top = `${face.top}px`;
}
