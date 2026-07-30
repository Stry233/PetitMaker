/**
 * group-arc.ts — the contract and the geometry a GROUP ROTATION is animated with, shared by both
 * views so the 2D and 3D tweens cannot drift apart.
 *
 * A group rotation is ONE rigid body turning about ONE point: every member's POSITION turns about
 * the selection's centre and each rotatable member's own facing advances by the same quarter turn.
 * (Spinning every member in place is a different operation, and not this one.) Two invariants make
 * that read as a single body, and both live here:
 *
 * ARC, NEVER A LINE. What eases is the ANGLE about the pivot; the radius is held. Interpolating a
 * member's position straight from old to new cuts the chord, pulling it inside the turning circle,
 * so the arrangement contracts and re-expands through the middle of the motion.
 *
 * ONE CLOCK. One `GroupRotation` describes the whole turn — one pivot, one sweep, every member — so
 * a view animates it as a single tween. A per-member signal could not share a start, a duration or
 * an easing, and any offset between members dissolves the one-body illusion.
 *
 * The commands apply INSTANTLY: by the time a view can draw a frame, every member already sits at
 * its final transform. `arcOffset` therefore returns the displacement FROM THAT REST POSE, which is
 * zero at the end of the sweep by construction — a tween can only land where the map already put the
 * object, whatever the easing did on the way there (an overshoot included).
 */

export interface GroupRotationMember {
  id: string;
  /** The member's footprint CENTRE in macro cells BEFORE the turn: the one fact a view cannot read
   *  off its own state, since the object is already standing at its destination. The centre is what
   *  turns rigidly (the anchor does not — a non-square footprint swaps its extent). */
  from: { x: number; y: number };
  /** Whether this member's own facing advanced by the sweep (a rotatable item). A CARRIED member
   *  travels the arc without turning: animating a spin would show a turn that never happened. */
  spun: boolean;
}

export interface GroupRotation {
  /** The turn's centre in macro cells — the centre of the selection's macro bounding box, including
   *  the half-cell nudge an odd-extent box lands on, so the arc matches where members really went. */
  pivot: { x: number; y: number };
  /** Signed sweep in degrees, +90 = clockwise (cell/screen space, y down). */
  sweepDeg: number;
  members: readonly GroupRotationMember[];
}

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
 * The member's displacement from its REST position, in macro cells, `eased` of the way through a
 * `sweepRad` turn. The angle is what advances and the radius is held (see the file header): at
 * eased = 0 this is the pre-turn position, at eased = 1 it is exactly zero, and an easing that
 * overshoots swings the member past its destination along the same circle.
 *
 * A member sitting ON the pivot has radius 0 and never moves, which is correct: the centre of the
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
 * again as an offset from rest (0 at eased = 1). Its facing advances on the SAME clock and the same
 * easing as its travel, so the member turns exactly as much as the body carrying it.
 */
export function spinOffset(sweepRad: number, eased: number): number {
  return sweepRad * (eased - 1);
}
