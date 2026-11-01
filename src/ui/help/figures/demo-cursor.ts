/*
 * The Help figures' pointer is the app's own cursor art, as a DOM image at the drawn size every
 * pictured cursor uses. The image hangs off the pointer host at the negative hotspot offset, so the
 * host's own position is the acting point: the pixel the click lands on. A touch reader's figures
 * draw a fingertip there instead.
 */
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { PICTURED_CURSOR_PX, picturedCursor } from '../../design/cursors/pictured-cursor';
import { PLATE, PLATE_INK, rgbaOf } from '../../design/tokens';

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
  // The art swaps once decoded, so a change of cursor never shows a blank frame between the two.
  if (img.dataset.want !== face.url) {
    img.dataset.want = face.url;
    const next = new Image();
    next.src = face.url;
    const shown = img;
    void next.decode().catch(() => {}).then(() => { if (host.firstElementChild === shown && shown.dataset.want === face.url) shown.src = face.url; });
  }
  img.style.width = `${PICTURED_CURSOR_PX}px`;
  img.style.height = `${PICTURED_CURSOR_PX}px`;
  img.style.left = `${face.left}px`;
  img.style.top = `${face.top}px`;
}

/** The drawn fingertip in CSS px: the cream dot the welcome tips' touch reels show, at the size a
 *  pictured cursor takes. */
const FINGER_PX = 22;

/** Put a fingertip into `host`, centred on the host's position (the acting point); `pressed` sinks it
 *  as the tips' reels do while the finger is down. */
export function drawFingerMark(host: HTMLElement, pressed: boolean): void {
  let dot = host.firstElementChild as HTMLElement | null;
  if (!dot || dot.dataset.finger === undefined) {
    dot = document.createElement('span');
    dot.dataset.finger = '';
    Object.assign(dot.style, {
      position: 'absolute', left: `${-FINGER_PX / 2}px`, top: `${-FINGER_PX / 2}px`,
      width: `${FINGER_PX}px`, height: `${FINGER_PX}px`, borderRadius: '50%', boxSizing: 'border-box',
      background: rgbaOf(PLATE, 0.92), border: `2.5px solid ${PLATE_INK}`,
    } satisfies Partial<CSSStyleDeclaration>);
    host.replaceChildren(dot);
  }
  dot.style.transform = pressed ? 'scale(0.78)' : 'scale(1)';
}
