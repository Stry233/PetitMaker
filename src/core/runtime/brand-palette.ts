/**
 * The interface palette's literal values that a consumer below `ui` also needs: the classic cursor
 * art, the canvas layers that letter and outline things on the map, the export painter and the
 * static legal pages. `ui/design/styles.ts`'s `colors` and `ui/design/tokens.ts` stay the place a
 * component reads a design colour; they take these values from here. Named for what each colour
 * IS, not for who currently reads it.
 *
 * Map/terrain colours (`ELEVATION_COLORS`, `WATER_COLOR`, `ZONE_COLORS`) live in
 * `core/model/constants.ts`.
 */

/** The dark ink behind the frame / load-pill / text (`ui/design/styles.ts`'s `colors.frameDark`). */
export const FRAME_INK = '#43413F';

/** The cream panel fill (`ui/design/styles.ts`'s `colors.panelCream`). */
export const CREAM = '#FFFBE1';

/** The error/destructive red (`ui/design/styles.ts`'s `colors.statusError`). */
export const ERROR_RED = '#FF6B6B';

/** Body text on a cream surface (`colors.textPrimary`). */
export const TEXT_PRIMARY = '#4A3B32';

/** File-row and secondary label brown (`colors.brownText`). */
export const BROWN_TEXT = '#826042';

/** The recessed surface behind code and table heads (`colors.surfaceSecondary`). */
export const SURFACE_SECONDARY = '#F3EEE8';

/** Text standing on the map: a warm off-white sampled off the game itself (`ui/design/tokens.ts`'s
 *  `MAP_TEXT`). Not `#FFFFFF`, which reads as a system overlay dropped on the map. */
export const MAP_TEXT = '#FFFEE3';

/** The dark brown glyph ink (`tokens.ts`'s `INK`) and the edge every word and drawing on the map wears. */
export const MAP_INK = '#574935';

/** How much ink an edge on the map carries, for a word and a drawing alike. */
export const MAP_EDGE_ALPHA = 0.62;
