/** A map direction as the active view shows it: the angle it stands at on screen, and the one arrow
 *  that draws it, which the selection card's facings and the generate shelf's facing share. */
import type { ViewProjection } from '../../../tools/pointer/runtime';

/** The screen angle, clockwise from up, of the map direction (dx, dy) standing at map point `at`
 *  through `proj`; the angle on an unturned flat map where either is missing. */
export function screenAngleOf(dx: number, dy: number, at: { x: number; y: number } | null, proj: ViewProjection | undefined): number {
  if (!at || !proj) return Math.atan2(dx, -dy) * 180 / Math.PI;
  const a = proj.cellToScreen(at.x, at.y), b = proj.cellToScreen(at.x + dx, at.y + dy);
  return Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
}

/** An arrow pointing `deg` clockwise from up, marked with the choice it draws (`data-facing`). */
export const DirectionArrow = ({ facing, deg }: { facing: string; deg: number }) => (
  <svg data-facing={facing} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', transform: `rotate(${deg}deg)` }}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
