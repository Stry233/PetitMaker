/** View constants both map views read. */
import { hexStringToNumber } from '../../../core/base/color';

/** The zoom factor of one step in, in every view; a step out divides by the same factor, so a step
 *  in and a step out land where they began. `button` is a zoom-in or zoom-out press of the camera
 *  controls; `notch` is a mouse wheel notch, which the 3D view's eased dolly takes larger. */
export const ZOOM_STEP = { button: 1.25, notch: { map2d: 1.1, map3d: 1.15 } } as const;

/** The warning red over map content an edit would lose, and under an invalid placement ghost, in
 *  every view that draws it. */
export const LOSS_COLOR = '#e2574c';
/** `LOSS_COLOR` as an engine colour: a ghost's loss wash, a refused 3D ghost body and the planet
 *  frame's warning flash. */
export const GHOST_LOSS = hexStringToNumber(LOSS_COLOR);
