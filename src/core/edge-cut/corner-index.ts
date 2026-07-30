/**
 * The corner-index convention — the SINGLE source for "which corner is index N" across the whole
 * codebase (2D trim shapes, 3D terrain geometry, the cut validator, the agent trim tool, quality
 * hints). A cell's `Corners` tuple is ordered [0, 1, 2, 3] = top-left, top-right, bottom-left,
 * bottom-right (this mirrors CORNER_NEIGHBORS in terrain-silhouette.ts).
 *
 * TWO label systems name the SAME four positions, so keep them here together rather than as rival
 * copies that drift:
 *   - screen quadrants (`CornerPos`):  TL, TR, BL, BR — the renderers' vocabulary.
 *   - compass (`CornerCompass`):       NW, NE, SW, SE — the `CornerTrim` 'tri-XX' suffixes AND the
 *                                       agent trim_corner API.
 * NW=TL, NE=TR, SW=BL, SE=BR (same index either way).
 */
export type CornerPos = 'TL' | 'TR' | 'BL' | 'BR';

/** index → screen-quadrant label. */
export const CORNER_POS: readonly CornerPos[] = ['TL', 'TR', 'BL', 'BR'];
/** screen-quadrant label → index. */
export const CORNER_INDEX: Record<CornerPos, number> = { TL: 0, TR: 1, BL: 2, BR: 3 };

/** index → compass label (== the `CornerTrim` 'tri-XX' suffix and the agent's corner vocabulary). */
export const CORNER_COMPASS = ['NW', 'NE', 'SW', 'SE'] as const;
export type CornerCompass = typeof CORNER_COMPASS[number];
