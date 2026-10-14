/**
 * Selection marks and the hover box, which both views draw in the map-label treatment: warm
 * off-white ink over a translucent dark edge. Lengths are screen px; a view that draws in world px
 * passes `k`, the world px per screen px.
 */
export const SELECTION_MARKS = {
  /** Bracket and exact-outline line widths: the ink line and the dark edge under it. */
  stroke: 2.6,
  edge: 5,
  /** Bracket inset around one member and around the whole of a group. */
  pad: 4,
  groupPad: 10,
  /** Bracket arm length bounds; between them an arm is a third of the box's short side. */
  armMin: 6,
  armMax: 14,
  /** Per-member ring line widths and least radius. */
  ringStroke: 2,
  ringEdge: 4,
  ringMin: 4,
  /** Past this many members a projected view draws only the group brackets. */
  ringLimit: 400,
} as const;

/** The hover box: a thin edge in the marks' dark ink at half strength over a faint light wash. */
export const HOVER_BOX = {
  stroke: 1.5,
  radius: 3,
  edgeAlpha: 0.5,
  fill: 0xffffff,
  fillAlpha: 0.08,
} as const;

/** Bracket arm length for a padded box of `w` x `h`. */
export function bracketArm(w: number, h: number, k = 1): number {
  return Math.max(SELECTION_MARKS.armMin * k, Math.min(SELECTION_MARKS.armMax * k, Math.min(w, h) / 3));
}

/** Ring radius around a member box of `w` x `h`. */
export function ringRadius(w: number, h: number, k = 1): number {
  return Math.max(SELECTION_MARKS.ringMin * k, Math.min(w, h) / 2 + k);
}
