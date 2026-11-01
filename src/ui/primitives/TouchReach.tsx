/**
 * The invisible hit area that lets a finger press a control drawn smaller than `TOUCH_TARGET`. It
 * stands inside the control (a positioned element that does not clip), so a press on it is a press
 * on the control, and it changes neither the drawing nor the layout. PC mode renders nothing.
 */
import type { CSSProperties } from 'react';
import { useTouchMode } from '../design/input-mode';
import { reachShareOf, touchReachPx, useScaleView, useSurfaceZoom } from '../design/scale';

/** The sides a hit area may grow past. Two controls that touch each close the side they share, so
 *  each takes its growth on its own side and neither covers the other. */
export interface ReachSides { top: boolean; right: boolean; bottom: boolean; left: boolean }

const EVERY_SIDE: ReachSides = { top: true, right: true, bottom: true, left: true };

/** How far past its two ends an axis of `size` px grows to span `reach` px: split between two open
 *  ends, all on one, none when it is already that long or closed at both ends. */
function growth(size: number, reach: number, start: boolean, end: boolean): [number, number] {
  const short = Math.max(0, reach - size);
  if (start && end) return [short / 2, short / 2];
  return [start ? short : 0, end ? short : 0];
}

/** One axis of the area's box: numeric insets for a known size, or a CSS minimum around the box
 *  itself (`max(100%, reach)`) for a size only layout knows, such as a word's width. */
function axisStyle(size: number | undefined, reach: number, start: boolean, end: boolean,
  [from, to, extent, shift]: readonly ['top' | 'left', 'bottom' | 'right', 'height' | 'width', 'translateY' | 'translateX']):
  { style: CSSProperties; shift?: string } {
  if (size !== undefined) {
    const [a, b] = growth(size, reach, start, end);
    return { style: { [from]: -a, [to]: -b } };
  }
  const span = `max(100%, ${reach}px)`;
  if (start && end) return { style: { [from]: '50%', [extent]: span }, shift: `${shift}(-50%)` };
  if (start) return { style: { [to]: 0, [extent]: span } };
  if (end) return { style: { [from]: 0, [extent]: span } };
  return { style: { [from]: 0, [to]: 0 } };
}

/** The area's box for a `w` x `h` control (its own px) that a finger needs `reach` px of. */
function reachStyle(w: number | undefined, h: number | undefined, reach: number, sides: ReachSides = EVERY_SIDE): CSSProperties {
  const y = axisStyle(h, reach, sides.top, sides.bottom, ['top', 'bottom', 'height', 'translateY']);
  const x = axisStyle(w, reach, sides.left, sides.right, ['left', 'right', 'width', 'translateX']);
  const shifts = [x.shift, y.shift].filter(Boolean);
  return { position: 'absolute', ...y.style, ...x.style, ...(shifts.length ? { transform: shifts.join(' ') } : {}) };
}

/**
 * `w` and `h` are the control's box in its own px, omitted where only layout knows it, and `zoom`
 * the visual px per own px it is drawn at, by default the zoom of the surface it stands on
 * (`design/scale.tsx:useSurfaceZoom`). `labelFor` makes the area a `<label>` for that field id,
 * for a control (an input) that cannot hold it.
 */
export function TouchReach({ w, h, zoom, sides, labelFor }: {
  w?: number; h?: number; zoom?: number; sides?: Partial<ReachSides>; labelFor?: string;
}) {
  const touch = useTouchMode();
  const share = reachShareOf(useScaleView());
  const surface = useSurfaceZoom();
  if (!touch) return null;
  const style = reachStyle(w, h, touchReachPx(zoom ?? surface, share), { ...EVERY_SIDE, ...sides });
  return labelFor === undefined
    ? <span data-touch-reach aria-hidden style={style} />
    : <label data-touch-reach aria-hidden htmlFor={labelFor} style={style} />;
}
