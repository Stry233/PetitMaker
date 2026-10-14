/**
 * The interface palette's literal values that a consumer below `ui` also needs: the canvas layers
 * that letter and outline things on the map, the export painter, the web manifest and the static
 * legal pages. `ui/design/tokens.ts` stays the place a component reads a
 * design colour; it takes these values from here. Named for what each colour is, not for who
 * currently reads it.
 *
 * Map/terrain colours (`ELEVATION_COLORS`, `WATER_COLOR`, `ZONE_COLORS`) live in
 * `view/shared/viewport/view-constants.ts`.
 */
import { hexChannels } from '../core/base/color.ts';

/** The dark ink behind the frame, the load pill and chrome text. */
export const FRAME_INK = '#43413F';

/** The cream every card, plate and loading screen stands on. */
export const PLATE = '#FDFBE0';

/** The error and destructive red. */
export const ERROR_RED = '#FF6B6B';

/** Secondary text on a cream surface. */
export const TEXT_SECONDARY = '#8A7B72';

/** The disclosure badges an export wears: AI-assisted content and procedurally generated content. */
export const AI_BADGE = '#8E7BD6';
export const PROCEDURAL_BADGE = '#5BB6A6';

/** Body text on a cream surface. */
export const TEXT_PRIMARY = '#4A3B32';

/** File-row and secondary label brown. */
export const BROWN_TEXT = '#826042';

/** The recessed surface behind code and table heads. */
export const SURFACE_SECONDARY = '#F3EEE8';

/** The paper an exported picture is printed on, under every card and band. */
export const EXPORT_PAPER = '#FFFDF5';

/** The cards an export lays on its paper: the layer thumbnails, the 3D card and the QR plate. */
export const EXPORT_CARD = '#FFFFFF';

/** The star and label on an export's disclosure badge. */
export const EXPORT_ON_BADGE = '#FFFFFF';

/** The sky an export's map band shows when the map could not be captured. */
export const EXPORT_MAP_PLACEHOLDER = '#BFEAFE';

/** A layer thumbnail's caption under its picture. */
export const EXPORT_CAPTION = '#5A4F47';

/** The soil the export's layer icon stacks on top. */
export const EXPORT_SOIL = '#9A6B3F';

/** The four tiles of the share-code heading's icon, in reading order. */
export const EXPORT_CODE_TILES: readonly string[] = ['#D9B86A', '#9CCF6E', '#7FB5D6', '#C8A6D6'];

/** Text standing on the map: a warm off-white sampled off the game itself (`ui/design/tokens.ts`'s
 *  `MAP_TEXT`). Not `#FFFFFF`, which reads as a system overlay dropped on the map. */
export const MAP_TEXT = '#FFFEE3';

/** The dark brown glyph ink (`tokens.ts`'s `INK`) and the edge every word and drawing on the map wears. */
export const MAP_INK = '#574935';

/** How much ink an edge on the map carries, for a word and a drawing alike. */
export const MAP_EDGE_ALPHA = 0.62;

/** A channel-wise `rgba()` of a 6-digit hex colour, for a value that must blend at an exact alpha. */
export function rgbaOf(hex: string, alpha: number): string {
  const [r, g, b] = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The plain white a map is laid on for the map check, so transparent areas read as nothing. */
export const CAPTURE_MATTE = '#FFFFFF';

/** The disclosure pill a model-drawn picture wears: its translucent fill and its words. */
export const AI_TAG_FILL = '#2B2621';
export const AI_TAG_INK = '#F7F3E8';
