/**
 * Which of the two cursor sets the pointer wears. Flipping this swaps every cursor the app draws,
 * on both canvases and on every DOM surface: the generated PNG set in `cursor-art.ts`, which is what
 * this build ships, for the code-drawn SVG set in `cursor-art-classic.ts`, which stays as the
 * alternative. Both are complete over the `CursorId` catalogue and each carries its own hotspots,
 * since a hotspot belongs to a drawing rather than to an id.
 *
 * The system-cursor preference outranks this: handing the pointer back to the OS is an accessibility
 * choice, and is answered before the question of which set is even asked.
 *
 * It is its own module because `cursor-css.ts` reads it to resolve an id to art, and a switch has to
 * be replaceable without replacing what it switches.
 */
export const USE_CLASSIC_CURSORS = false;
