/**
 * The inks drawn art paints with: the assistant's character, its badges and the masks the sprite and
 * the sketchbook cut with. Each is a colour of the drawing it belongs to, not an interface role, so a
 * control never reads one.
 */
import { ACTIVE } from './tokens';

/** Mask luminance: white keeps what it covers, black cuts it away. */
export const MASK_KEEP = '#fff';
export const MASK_CUT = '#000';

/** The character's closed-eye lid: its skin and lash inks, from the drawing they are painted over. */
export const LID_SKIN = '#F9DB99';
export const LID_LASH_INK = '#6B5237';

/** The breath bubble: a paler fill and a much darker rim than the dust puff's, because it is a bubble
 *  of air read against her shoulder rather than ground kicked up under her feet. */
export const BREATH_FILL = '#EFECE0';
export const BREATH_RIM = '#8F8778';

/** The yellow badges: the active yellow, outlined in warm tan, and the note card's paper. */
export const BADGE_GOLD = ACTIVE;
export const BADGE_GOLD_OUTLINE = '#B5884F';
export const BADGE_NOTE_PAPER = '#FFF7DF';

/** The taupe badges: their fill, the fainter third zzz, and the gray outline they share with the breath rim. */
export const BADGE_TAUPE = '#C9C2B4';
export const BADGE_TAUPE_FAINT = '#D8D2C5';
export const BADGE_TAUPE_OUTLINE = BREATH_RIM;
