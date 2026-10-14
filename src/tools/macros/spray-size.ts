import { BRUSH_SIZE } from '../../state/editing/edit-mode';

/** The five brush widths map to local spray radii in terrain cells. */
export function sprayRadius(brushSize: number): number { return brushSize + 3; }

/** The radius of a press at the bar's smallest brush. */
export const SPRAY_MIN_RADIUS = sprayRadius(BRUSH_SIZE.min);

/** How often, in milliseconds, a held Smart Build press fires its next burst. */
export const HOLD_BURST_MS = 350;
