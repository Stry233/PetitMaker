import { FRAME_INK } from '../../../assets/brand-palette';

/** A region's fill in both views. White lightens whatever lies under it: in 3D the fill tints the
 *  terrain, which is mostly green, and a green tint over grass would leave the region unseen. */
export const REGION_FILL = { color: '#ffffff', alpha: 0.24 } as const;

/** A framed region's outline as each line is drawn, under to over, centred on the edge: a dark edge
 *  and the white line on it, widths in px. */
export const REGION_EDGE = [
  { width: 4, color: FRAME_INK, alpha: 0.55 },
  { width: 1.75, color: '#ffffff', alpha: 0.95 },
] as const;
