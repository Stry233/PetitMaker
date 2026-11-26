/** View constants both map views read. */
import { hexStringToNumber, lerpColor } from '../../../core/base/color';

/** The zoom factor of one step in, in every view; a step out divides by the same factor, so a step
 *  in and a step out land where they began. `button` is a zoom-in or zoom-out press of the camera
 *  controls; `notch` is a mouse wheel notch, which the 3D view's eased dolly takes larger. */
export const ZOOM_STEP = { button: 1.25, notch: { map2d: 1.1, map3d: 1.15 } } as const;

/** Radians a camera turns per screen px of drag, in every view: the one place the two units meet,
 *  so a drag, the glide after it and a rail step turn both views alike. */
export const TURN_RAD_PER_PX = 0.005;

/** How far one press of a turn button turns either view, in the drag px `TURN_RAD_PER_PX` reads. */
export const TURN_STEP_PX = 60;

/** The warning red over map content an edit would lose, and under an invalid placement ghost, in
 *  every view that draws it. */
export const LOSS_COLOR = '#e2574c';
/** `LOSS_COLOR` as an engine colour: a ghost's loss wash, a refused placement ghost and the planet
 *  frame's warning flash. */
export const GHOST_LOSS = hexStringToNumber(LOSS_COLOR);

/**
 * The placement ghost's look in both views, which show the real thing (model or sprite, road
 * surface, terrain blocks) at `opacity`. A refused ghost's own colours move `refusedTint` of the way
 * to `GHOST_LOSS` and its footprint is washed in it at `refusedWash`. Outlines are in map cells:
 * a valid footprint's thin line over its dark `halo`, a refused footprint's wider loss-red line. In
 * 2D a mountain block's edge is its colour darkened by `blockEdge.darken`, so layer 1 reads against
 * grass.
 */
export const GHOST_LOOK = {
  opacity: 0.6,
  refusedTint: 0.8,
  refusedWash: 0.35,
  outline: { valid: 0.03, halo: 0.07, refused: 0.07 },
  blockEdge: { darken: 0.45, width: 0.08 },
} as const;

/** A ghost's own colour `color`, as drawn in `valid`'s state. */
export function ghostColor(color: number, valid: boolean): number {
  return valid ? color : lerpColor(color, GHOST_LOSS, GHOST_LOOK.refusedTint);
}

/** The multiplier a ghost's art or model wears (a sprite tint, a material colour): white when
 *  valid, so its own colours show. */
export function ghostTint(valid: boolean): number {
  return ghostColor(0xffffff, valid);
}

/** An object flagged as standing where it may not (a hand repair's problems), in every view and
 *  picture that draws it: its footprint washed at `wash` and edged `edgePx` screen px wide in
 *  `GHOST_LOSS`. */
export const FLAG_MARK = { wash: 0.35, edgePx: 2 } as const;
