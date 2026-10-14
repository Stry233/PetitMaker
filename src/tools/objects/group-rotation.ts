/**
 * One group rotation as data: one pivot, one sweep and every member, so a view animates the whole
 * turn as a single tween. The commands apply instantly, so a member's `from` is the one fact a
 * view cannot read off its own state.
 */
interface GroupRotationMember {
  id: string;
  /** The member's footprint centre in macro cells before the turn: the one fact a view cannot read
   *  off its own state, since the object is already standing at its destination. The centre is what
   *  turns rigidly (the anchor does not — a non-square footprint swaps its extent). */
  from: { x: number; y: number };
  /** Whether this member's own facing advanced by the sweep (a rotatable item). A carried member
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
