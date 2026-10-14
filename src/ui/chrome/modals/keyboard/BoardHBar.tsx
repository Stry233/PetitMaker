/** The board's drawn horizontal scrollbar, and the zoom that fits the board to its room before it scrolls. */
import { cssMotion } from '../../../design/motion';
import { MUTED, rgbaOf } from '../../../design/tokens';
import { radii, cursors } from '../../../design/styles';
import { clientPoint } from '../../../../platform/device/viewport-space';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { visualRect } from '../../../design/visual-rect';

/** The board shrinks to the region down to this before it scrolls sideways. */
export const BOARD_ZOOM_FLOOR = 0.75;

/** The zoom that fits the board into the room it has on both axes, never above 1 and never under the floor. */
export function boardZoomFor(regionWidth: number, boardWidth: number, regionHeight = Infinity, boardHeight = 1): number {
  if (regionWidth <= 0 || boardWidth <= 0) return 1;
  const fit = Math.min(regionWidth / boardWidth, regionHeight / boardHeight);
  return Math.min(1, Math.max(BOARD_ZOOM_FLOOR, fit));
}

export const HBAR_H = 12;
// The visible pill: the cozy bar's 12px lane minus its 3px transparent inset each side.
export const HBAR_THUMB = 6;
export const HBAR_FILL = `var(--sb-thumb, ${rgbaOf(MUTED, 0.4)})`;
export const HBAR_FILL_HOVER = `var(--sb-thumb-hover, ${rgbaOf(MUTED, 0.62)})`;
/**
 * The board's horizontal bar: the region hides the platform bars (`pw-noscroll`) and the edge fade
 * says "more", but a fade cannot be grabbed — this draws a thumb over the same native scroller and
 * writes back. Mounted only while the board actually overflows. It wears the app's cozy scrollbar
 * look (`animations.css`: a thin warm pill on a transparent lane, the modals' own bars), drawn out
 * here only because the region's two-axis fade mask would wash a bar inside the scroller along its
 * whole length.
 */
export function BoardHBar({ left, vw, cw, label, onScrollTo }: {
  left: number; vw: number; cw: number; label: string;
  onScrollTo: (left: number, glide: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The pointer's offset into the thumb while a drag holds it, in track px. */
  const grab = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const room = Math.max(0, cw - vw);
  // The floor keeps the thumb grabbable on a very wide board; percentage of the track, so it
  // follows the window without a measured width.
  const thumbFrac = Math.max(0.08, cw > 0 ? vw / cw : 1);
  const posFrac = room > 0 ? left / room : 0;

  const scrollFor = (clientX: number): number | null => {
    const rect = ref.current ? visualRect(ref.current) : null;
    if (!rect || rect.width === 0) return null;
    const thumbW = rect.width * thumbFrac;
    const travel = rect.width - thumbW;
    if (travel <= 0) return 0;
    const thumbLeft = clientX - rect.left - (grab.current ?? thumbW / 2);
    return Math.min(room, Math.max(0, (thumbLeft / travel) * room));
  };
  const down = (e: ReactPointerEvent<HTMLElement>, onThumb: boolean): void => {
    const rect = ref.current ? visualRect(ref.current) : null;
    if (!rect || rect.width === 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const thumbW = rect.width * thumbFrac;
    // Grabbing the thumb keeps the point under the pointer; pressing the track jumps the thumb's
    // centre there, so the press lands where the user aimed rather than a thumb-width away.
    grab.current = onThumb ? clientPoint(e).x - rect.left - (rect.width - thumbW) * posFrac : thumbW / 2;
    const to = scrollFor(clientPoint(e).x);
    if (to !== null) onScrollTo(to, !onThumb);
  };

  return (
    <div
      ref={ref}
      role="scrollbar"
      aria-label={label}
      aria-controls="kbd-region"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(room)}
      aria-valuenow={Math.round(left)}
      onPointerDown={(e) => down(e, false)}
      onPointerMove={(e) => {
        if (!e.buttons || grab.current === null) return;
        const to = scrollFor(clientPoint(e).x);
        if (to !== null) onScrollTo(to, false);
      }}
      onPointerUp={() => { grab.current = null; }}
      style={{ position: 'relative', height: HBAR_H, margin: '6px 6px 0', flexShrink: 0, cursor: cursors.clickable, touchAction: 'none' }}
   >
      <span
        data-testid="kbd-hbar-thumb"
        onPointerDown={(e) => { e.stopPropagation(); down(e, true); }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          position: 'absolute', top: (HBAR_H - HBAR_THUMB) / 2, height: HBAR_THUMB,
          left: `${posFrac * (1 - thumbFrac) * 100}%`, width: `${thumbFrac * 100}%`,
          borderRadius: radii.pill, background: hover ? HBAR_FILL_HOVER : HBAR_FILL,
          transition: cssMotion('control.paint', ['background-color']),
        }}
      />
    </div>
  );
}
