/** The colours a plan note can wear. */

/** Cream annotation color rendered with white outlines and neutral number badges. */
const ANNOTATION_INK = '#FFFEE3';

/** The neutral number badge an ink zone wears in place of its own colour. */
export const INK_ZONE_DISC = '#8A9BAE';

/** Palette chosen for contrast over grass, sand, and water. The final cream uses neutral number
 * badges and matches the map-lettering color. */
export const ANNOTATION_COLORS: readonly string[] = [
  '#FF8A7A', '#E5484D', '#FFB347', '#FFD84D',
  '#9BC53D', '#2FBF9B', '#38BDF8', '#3B82F6',
  '#818CF8', '#A78BFA', '#C969E6', '#FF7BAE',
  '#A9704C', INK_ZONE_DISC, '#5D5A55', ANNOTATION_INK,
];

/** Whether a note wears the cream ink rather than a palette colour. */
export function isAnnotationInk(color: string): boolean {
  return color.toLowerCase() === ANNOTATION_INK.toLowerCase();
}
