/**
 * The contract and geometry a group rotation is animated with, shared by both views so their tweens
 * cannot drift apart. A group rotation is one rigid body turning about one point: positions turn
 * about the selection's centre and each rotatable member's facing advances a quarter turn.
 *
 * Arc, never a line: the angle about the pivot eases and the radius is held, since a straight
 * interpolation cuts the chord and the arrangement contracts mid-turn.
 *
 * One clock: one `GroupRotation` (one pivot, one sweep, every member) is one tween; per-member
 * signals could not share start, duration and easing.
 *
 * The commands apply instantly, so `arcOffset` is the displacement from the final rest pose, zero at
 * the end of the sweep: a tween always lands where the map already put the object.
 */

/** A member's start position in polar form about the pivot, in macro cells. */
export interface ArcMotion {
  readonly a0: number;
  readonly radius: number;
}

export function arcMotion(pivot: { x: number; y: number }, from: { x: number; y: number }): ArcMotion {
  const dx = from.x - pivot.x, dy = from.y - pivot.y;
  return { a0: Math.atan2(dy, dx), radius: Math.hypot(dx, dy) };
}

/**
 * The member's displacement from its rest position, in macro cells, `eased` of the way through a
 * `sweepRad` turn. The angle is what advances and the radius is held (see the file header): at
 * eased = 0 this is the pre-turn position, at eased = 1 it is exactly zero, and an easing that
 * overshoots swings the member past its destination along the same circle.
 *
 * A member sitting on the pivot has radius 0 and never moves, which is correct: the centre of the
 * turn is the one place a rotation leaves alone.
 */
export function arcOffset(m: ArcMotion, sweepRad: number, eased: number): { dx: number; dy: number } {
  const end = m.a0 + sweepRad;
  const a = m.a0 + sweepRad * eased;
  return {
    dx: m.radius * (Math.cos(a) - Math.cos(end)),
    dy: m.radius * (Math.sin(a) - Math.sin(end)),
  };
}

/**
 * How far a spun member's own facing still has to turn, in radians, `eased` through the sweep —
 * again as an offset from rest (0 at eased = 1). Its facing advances on the same clock and the same
 * easing as its travel, so the member turns exactly as much as the body carrying it.
 */
export function spinOffset(sweepRad: number, eased: number): number {
  return sweepRad * (eased - 1);
}
