/**
 * The chrome palette's literal values that a consumer below `ui` also needs. `ui/design/styles.ts`'s
 * `colors` is the living token set and stays the one place a component reads a design colour;
 * this module exists only so something outside `ui` (the classic cursor art, drawn to match the
 * app's own chrome) can read the same three hex values without importing UI. Named for what each
 * colour IS, not for who currently reads it, since a later consumer down here should not have to
 * read "cursor" to find the ink.
 *
 * Map/terrain colours (`ELEVATION_COLORS`, `WATER_COLOR`, `ZONE_COLORS`) live in
 * `core/model/constants.ts`; these are chrome colours, not map ones, hence the separate module.
 */

/** The dark ink behind the frame / load-pill / text (`ui/design/styles.ts`'s `colors.frameDark`). */
export const INK = '#43413F';

/** The cream panel fill (`ui/design/styles.ts`'s `colors.panelCream`). */
export const CREAM = '#FFFBE1';

/** The error/destructive red (`ui/design/styles.ts`'s `colors.statusError`). */
export const ERROR_RED = '#FF6B6B';
