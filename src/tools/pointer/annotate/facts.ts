/** What a surface reads about notes without the tool: the font size control's options for each note kind. */
import type { NoteTextSize, ZoneTextSize } from '../../../core/model/annotations';

/** The font size control's order; a chip is lettering, so it offers every size but 'none'. */
export const ZONE_TEXT_SIZES: readonly ZoneTextSize[] = ['s', 'm', 'l', 'none'];
export const CHIP_TEXT_SIZES: readonly NoteTextSize[] = ['s', 'm', 'l'];

