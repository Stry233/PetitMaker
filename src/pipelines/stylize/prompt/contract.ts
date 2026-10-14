/**
 * The imperative preserve-list every stylize prompt opens with: InstructPix2Pix-style edit models
 * follow commands ("keep the layout exactly") far more reliably than descriptions of a desired
 * end state, so the contract speaks in the imperative throughout.
 */
export const BASE_CONTRACT =
  'Redraw this town-planning map as one hand-illustrated picture. Keep the layout exactly: every road, path, river, lake, bridge, building and fence stays in place and keeps its footprint and proportions. Merge dense clusters of trees and flowers into soft painterly masses instead of drawing each one. No text, no letters, no labels, no watermark. Do not shrink the map or paint any margin, torn paper edge, water ring, border or frame around it: the map’s own ground must touch all four edges of the canvas.';

/** The writing desk's textarea cap: long enough for a real description, short enough that a
 *  provider's prompt field never truncates it silently. */
export const CUSTOM_PROMPT_MAX = 300;

/**
 * Appends `chip` onto `current` as one more clause, comma-joined. A trailing comma or run of
 * whitespace on `current` is trimmed first so a chip never doubles it. A chip that would push the
 * joined result past `max` is a no-op: the caller's counter already shows the user why nothing
 * changed, so no error path is needed here.
 */
export function appendFragment(current: string, chip: string, max: number = CUSTOM_PROMPT_MAX): string {
  const trimmed = current.replace(/[,\s]+$/, '');
  const joined = trimmed === '' ? chip : `${trimmed}, ${chip}`;
  return joined.length > max ? current : joined;
}
