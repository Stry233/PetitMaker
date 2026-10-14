import { ELEVATION_MAX } from '../../../../core/game/profile';

/** The settings each Generate figure shows side by side; the captions quote these lists. */
export const RICHNESS_SHOTS = [20, 60, 100] as const;
export const HEIGHT_SHOTS = [1, 4, ELEVATION_MAX] as const;
/** Contrast in percent, as the slider reads it. */
export const CONTRAST_SHOTS = [60, 130, 220] as const;
export const RELIEF_SHOTS = [2, 5, ELEVATION_MAX] as const;
